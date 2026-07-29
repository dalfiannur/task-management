//! End-to-end LabelService over the real Connect routers + Postgres.
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
const LABEL: &str = "/sedjiwa.tasks.label.v1.LabelService";

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
        .merge(transport::label_router(store.clone()))
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

fn label_ids(body: &Value) -> Vec<String> {
    body["labels"].as_array().cloned().unwrap_or_default().iter().map(|l| l["id"].as_str().unwrap().to_string()).collect()
}

#[tokio::test]
async fn labels_crud_and_guards() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let member = mk_user(&store).await;
    let outsider = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[&member]).await;
    let tm = token(&member);

    // Member creates a label.
    let l = ok(&router, &format!("{LABEL}/CreateLabel"), &tm, json!({ "projectId": pid, "name": "bug", "color": "#e11d48" })).await;
    assert_eq!(l["name"], "bug");
    assert_eq!(l["color"], "#e11d48");
    let lid = l["id"].as_str().unwrap().to_string();

    // Validation: blank name, bad color.
    let (st, _) = call(&router, &format!("{LABEL}/CreateLabel"), Some(&tm), json!({ "projectId": pid, "name": "  ", "color": "#000000" })).await;
    assert_ne!(st, StatusCode::OK, "blank name rejected");
    let (st, _) = call(&router, &format!("{LABEL}/CreateLabel"), Some(&tm), json!({ "projectId": pid, "name": "x", "color": "red" })).await;
    assert_ne!(st, StatusCode::OK, "non-hex color rejected");

    // Second label; list is member-gated + sorted by name.
    ok(&router, &format!("{LABEL}/CreateLabel"), &tm, json!({ "projectId": pid, "name": "aaa", "color": "#0ea5e9" })).await;
    let list = ok(&router, &format!("{LABEL}/ListLabels"), &tm, json!({ "projectId": pid })).await;
    let names: Vec<&str> = list["labels"].as_array().unwrap().iter().map(|l| l["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec!["aaa", "bug"], "sorted by name");
    let (st, _) = call(&router, &format!("{LABEL}/ListLabels"), Some(&token(&outsider)), json!({ "projectId": pid })).await;
    assert_ne!(st, StatusCode::OK, "non-member cannot list");

    // Update: patch color; invalid color rejected.
    let upd = ok(&router, &format!("{LABEL}/UpdateLabel"), &tm, json!({ "id": lid, "color": "#111111" })).await;
    assert_eq!(upd["color"], "#111111");
    assert_eq!(upd["name"], "bug", "name unchanged when omitted");
    let (st, _) = call(&router, &format!("{LABEL}/UpdateLabel"), Some(&tm), json!({ "id": lid, "color": "nope" })).await;
    assert_ne!(st, StatusCode::OK, "invalid color on update rejected");

    // Delete removes only the label.
    ok(&router, &format!("{LABEL}/DeleteLabel"), &tm, json!({ "id": lid })).await;
    let after = ok(&router, &format!("{LABEL}/ListLabels"), &tm, json!({ "projectId": pid })).await;
    assert!(!label_ids(&after).contains(&lid), "deleted label gone");
    assert_eq!(after["labels"].as_array().unwrap().len(), 1, "the other label remains");
}
