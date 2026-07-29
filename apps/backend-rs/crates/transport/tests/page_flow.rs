//! End-to-end PageService over the real Connect routers + Postgres.
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
const PAGE: &str = "/sedjiwa.tasks.page.v1.PageService";

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
        .merge(transport::page_router(store.clone()))
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

fn num(body: &Value, key: &str) -> i64 {
    body[key].as_i64().unwrap_or(0)
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

fn page_ids(body: &Value) -> Vec<String> {
    body["pages"].as_array().cloned().unwrap_or_default().iter().map(|p| p["id"].as_str().unwrap().to_string()).collect()
}

#[tokio::test]
async fn pages_lifecycle_and_guards() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let member = mk_user(&store).await;
    let outsider = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[&member]).await;
    let (to, tm) = (token(&owner), token(&member));

    // Member creates a page with defaults (Untitled, order 0, created_by=member).
    let p1 = ok(&router, &format!("{PAGE}/CreatePage"), &tm, json!({ "projectId": pid })).await;
    assert_eq!(p1["title"], "Untitled", "default title");
    assert_eq!(num(&p1, "order"), 0);
    assert_eq!(p1["createdBy"], member);
    assert_eq!(p1["lastEditedBy"], member);
    let p1id = p1["id"].as_str().unwrap().to_string();

    // Second page appends order 1; with explicit fields.
    let p2 = ok(&router, &format!("{PAGE}/CreatePage"), &tm, json!({ "projectId": pid, "title": "Runbook", "icon": "📘", "content": "# Steps" })).await;
    assert_eq!(num(&p2, "order"), 1);
    assert_eq!(p2["title"], "Runbook");
    assert_eq!(p2["icon"], "📘");
    let p2id = p2["id"].as_str().unwrap().to_string();

    // List member-gated: member sees both (ordered); non-member denied.
    let list = ok(&router, &format!("{PAGE}/ListPages"), &tm, json!({ "projectId": pid })).await;
    assert_eq!(page_ids(&list), vec![p1id.clone(), p2id.clone()]);
    let (st, _) = call(&router, &format!("{PAGE}/ListPages"), Some(&token(&outsider)), json!({ "projectId": pid })).await;
    assert_ne!(st, StatusCode::OK, "non-member cannot list");

    // Get member-gated; unknown id → not found.
    let (st, _) = call(&router, &format!("{PAGE}/GetPage"), Some(&token(&outsider)), json!({ "id": p1id })).await;
    assert_ne!(st, StatusCode::OK, "non-member cannot get");
    let (st, _) = call(&router, &format!("{PAGE}/GetPage"), Some(&tm), json!({ "id": "99999999" })).await;
    assert_ne!(st, StatusCode::OK, "unknown page not found");

    // Owner edits p1: content patched, last_edited_by = owner, created_by preserved.
    let upd = ok(&router, &format!("{PAGE}/UpdatePage"), &to, json!({ "id": p1id, "title": "Overview", "content": "Hello" })).await;
    assert_eq!(upd["title"], "Overview");
    assert_eq!(upd["content"], "Hello");
    assert_eq!(upd["lastEditedBy"], owner, "editor recorded");
    assert_eq!(upd["createdBy"], member, "author preserved");
    // Partial update (content absent) keeps content.
    let re = ok(&router, &format!("{PAGE}/UpdatePage"), &tm, json!({ "id": p1id, "icon": "🏠" })).await;
    assert_eq!(re["content"], "Hello", "content unchanged when omitted");
    assert_eq!(re["icon"], "🏠");

    // Reorder → p2 first.
    let ro = ok(&router, &format!("{PAGE}/ReorderPages"), &tm, json!({ "projectId": pid, "pageIds": [p2id, p1id] })).await;
    assert_eq!(page_ids(&ro), vec![p2id.clone(), p1id.clone()]);

    // Non-member cannot create.
    let (st, _) = call(&router, &format!("{PAGE}/CreatePage"), Some(&token(&outsider)), json!({ "projectId": pid })).await;
    assert_ne!(st, StatusCode::OK, "non-member cannot create");

    // Delete p2 → list has only p1.
    ok(&router, &format!("{PAGE}/DeletePage"), &tm, json!({ "id": p2id })).await;
    let after = ok(&router, &format!("{PAGE}/ListPages"), &tm, json!({ "projectId": pid })).await;
    assert_eq!(page_ids(&after), vec![p1id.clone()]);
}
