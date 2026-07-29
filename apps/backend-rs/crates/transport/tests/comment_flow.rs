//! End-to-end CommentService over the real Connect routers + Postgres.
//! Skipped unless `DATABASE_URL` is set. Unique ids so reruns stay isolated.

use std::sync::Arc;

use auth::{sign_jwt, verify_jwt};
use axum::body::{to_bytes, Body};
use axum::extract::Request;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::StatusCode;
use axum::middleware::{from_fn, Next};
use axum::response::Response;
use axum::Router;
use domain::user::{UserPassword, UserPhone, UserProfile, UserStatusComponent};
use persistence::Store;
use serde_json::{json, Value};
use tower::ServiceExt;

const SECRET: &str = "test-secret";
const PROJECT: &str = "/sedjiwa.tasks.project.v1.ProjectService";
const MODULE: &str = "/sedjiwa.tasks.work.v1.ModuleService";
const TASK: &str = "/sedjiwa.tasks.work.v1.TaskService";
const COMMENT: &str = "/sedjiwa.tasks.comment.v1.CommentService";

fn uniq() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos().to_string()
}

async fn auth_mw(mut req: Request, next: Next) -> Response {
    if let Some(tok) = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
    {
        if let Ok(u) = verify_jwt(tok.trim(), SECRET) {
            req.extensions_mut().insert(u);
        }
    }
    next.run(req).await
}

async fn setup() -> Option<(Router, Arc<Store>)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let store = Arc::new(Store::connect(&url, domain::register_all).await.unwrap());
    let router = transport::project_router(store.clone())
        .merge(transport::module_router(store.clone()))
        .merge(transport::task_router(store.clone()))
        .merge(transport::comment_router(store.clone()))
        .layer(from_fn(auth_mw));
    Some((router, store))
}

fn token(sub: &str) -> String {
    sign_jwt(SECRET, sub, &["projects:create".to_string()], 9_999_999_999).unwrap()
}

async fn call(router: &Router, path: &str, token: Option<&str>, body: Value) -> (StatusCode, Value) {
    let mut b = Request::builder().method("POST").uri(path).header(CONTENT_TYPE, "application/json");
    if let Some(t) = token {
        b = b.header(AUTHORIZATION, format!("Bearer {t}"));
    }
    let req = b.body(Body::from(body.to_string())).unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

async fn ok(router: &Router, path: &str, tok: &str, body: Value) -> Value {
    let (st, v) = call(router, path, Some(tok), body).await;
    assert_eq!(st, StatusCode::OK, "{path}: {v}");
    v
}

async fn mk_user(store: &Store) -> String {
    let now = "2026-01-01T00:00:00Z".to_string();
    store
        .create((
            UserPhone { value: format!("m{}", uniq()), verified: true },
            UserPassword { hash: "x".into(), changed_at: now.clone() },
            UserProfile { display_name: "M".into(), avatar_url: String::new(), email: String::new() },
            UserStatusComponent { status: "active".into(), created_at: now, last_login_at: None },
        ))
        .await
        .unwrap()
        .to_string()
}

async fn project_with(router: &Router, owner: &str, members: &[&str]) -> String {
    let p = ok(router, &format!("{PROJECT}/CreateProject"), &token(owner), json!({ "name": format!("P{}", uniq()) })).await;
    let id = p["id"].as_str().unwrap().to_string();
    for m in members {
        ok(router, &format!("{PROJECT}/AddProjectMember"), &token(owner), json!({ "projectId": id, "userId": m })).await;
    }
    id
}

async fn task_in(router: &Router, owner_tok: &str, member_tok: &str, project: &str) -> String {
    let m = ok(router, &format!("{MODULE}/CreateModule"), owner_tok, json!({ "projectId": project, "name": "M" })).await["id"].as_str().unwrap().to_string();
    ok(router, &format!("{TASK}/CreateTask"), member_tok, json!({ "moduleId": m, "title": "T" })).await["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn comments_crud_mentions_and_guards() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let member = mk_user(&store).await; // author
    let member2 = mk_user(&store).await;
    let outsider = mk_user(&store).await; // not a project member
    let pid = project_with(&router, &owner, &[&member, &member2]).await;
    let (to, tm, tm2) = (token(&owner), token(&member), token(&member2));
    let task = task_in(&router, &to, &tm, &pid).await;

    // Member creates a comment mentioning member2 (valid) + outsider (dropped).
    let c = ok(&router, &format!("{COMMENT}/CreateComment"), &tm, json!({
        "taskId": task, "content": "hi @there", "mentionedUserIds": [member2, outsider]
    })).await;
    assert_eq!(c["authorId"], member);
    assert_eq!(c["mentionedUserIds"], json!([member2]), "non-member mention dropped");
    let cid = c["id"].as_str().unwrap().to_string();

    // Blank content rejected.
    let (st, _) = call(&router, &format!("{COMMENT}/CreateComment"), Some(&tm), json!({ "taskId": task, "content": "   " })).await;
    assert_ne!(st, StatusCode::OK, "blank content rejected");

    // List is member-gated + paginated; non-member denied.
    ok(&router, &format!("{COMMENT}/CreateComment"), &tm2, json!({ "taskId": task, "content": "second" })).await;
    let list = ok(&router, &format!("{COMMENT}/ListComments"), &tm, json!({ "taskId": task })).await;
    assert_eq!(list["total"], 2);
    let contents: Vec<&str> = list["comments"].as_array().unwrap().iter().map(|c| c["content"].as_str().unwrap()).collect();
    assert_eq!(contents, vec!["hi @there", "second"], "chronological");
    let page2 = ok(&router, &format!("{COMMENT}/ListComments"), &tm, json!({ "taskId": task, "page": 2, "pageSize": 1 })).await;
    assert_eq!(page2["comments"].as_array().unwrap().len(), 1);
    assert_eq!(page2["comments"][0]["content"], "second", "page 2 of size 1");
    let (st, _) = call(&router, &format!("{COMMENT}/ListComments"), Some(&token(&outsider)), json!({ "taskId": task })).await;
    assert_ne!(st, StatusCode::OK, "non-member cannot list");

    // Edit is author-only: member2 cannot edit member's comment; author can.
    let (st, _) = call(&router, &format!("{COMMENT}/UpdateComment"), Some(&tm2), json!({ "id": cid, "content": "hacked" })).await;
    assert_ne!(st, StatusCode::OK, "non-author cannot edit");
    let upd = ok(&router, &format!("{COMMENT}/UpdateComment"), &tm, json!({ "id": cid, "content": "edited", "mentionedUserIds": [] })).await;
    assert_eq!(upd["content"], "edited");
    assert_ne!(upd["updatedAt"], upd["createdAt"], "updated_at bumped");

    // Delete: a plain member (not author/owner) denied; owner can moderate.
    let (st, _) = call(&router, &format!("{COMMENT}/DeleteComment"), Some(&tm2), json!({ "id": cid })).await;
    assert_ne!(st, StatusCode::OK, "non-author non-owner cannot delete");
    ok(&router, &format!("{COMMENT}/DeleteComment"), &to, json!({ "id": cid })).await;
    let after = ok(&router, &format!("{COMMENT}/ListComments"), &tm, json!({ "taskId": task })).await;
    assert_eq!(after["total"], 1, "owner moderated the comment away");
}
