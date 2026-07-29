//! End-to-end CreateProject over the real Connect router + Postgres.
//! Skipped unless `DATABASE_URL` is set.

use std::sync::Arc;

use auth::{sign_jwt, verify_jwt};
use axum::body::{to_bytes, Body};
use axum::extract::Request;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::StatusCode;
use axum::middleware::{from_fn, Next};
use axum::response::Response;
use axum::Router;
use domain::project::ProjectMembership;
use persistence::Store;
use serde_json::{json, Value};
use tower::ServiceExt;

const SECRET: &str = "test-secret";
const CREATE: &str = "/sedjiwa.tasks.project.v1.ProjectService/CreateProject";

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
    let router = transport::project_router(store.clone()).layer(from_fn(auth_mw));
    Some((router, store))
}

fn token(sub: &str) -> String {
    sign_jwt(SECRET, sub, &["projects:create".to_string()], 9_999_999_999).unwrap()
}

async fn call(router: &Router, token: Option<&str>, body: Value) -> (StatusCode, Value) {
    let mut b = Request::builder()
        .method("POST")
        .uri(CREATE)
        .header(CONTENT_TYPE, "application/json");
    if let Some(t) = token {
        b = b.header(AUTHORIZATION, format!("Bearer {t}"));
    }
    let req = b.body(Body::from(body.to_string())).unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

/// Member `user_id`s for a project id.
async fn members(store: &Store, project_id: &str) -> Vec<String> {
    let pid = project_id.to_string();
    let mut v = store
        .query::<ProjectMembership, String>(None, move |world, pairs| {
            pairs
                .iter()
                .filter_map(|(_, e)| world.get::<ProjectMembership>(*e))
                .filter(|m| m.project_id == pid)
                .map(|m| m.user_id.clone())
                .collect()
        })
        .await
        .unwrap();
    v.sort();
    v
}

#[tokio::test]
async fn create_default_owner_and_membership() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (st, body) = call(
        &router,
        Some(&token("42")),
        json!({ "name": "  Website Revamp  ", "description": "landing" }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "create: {body}");
    assert_eq!(body["name"], "Website Revamp", "name trimmed");
    assert_eq!(body["ownerId"], "42", "owner defaults to caller");
    assert_eq!(body["description"], "landing");
    assert_eq!(body["status"], "PROJECT_STATUS_ACTIVE");
    let id = body["id"].as_str().unwrap();

    assert_eq!(members(&store, id).await, vec!["42".to_string()], "owner is a member");
}

#[tokio::test]
async fn explicit_owner_keeps_creator_as_member() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (st, body) = call(
        &router,
        Some(&token("42")),
        json!({ "name": "Ops", "ownerId": "99" }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "create: {body}");
    assert_eq!(body["ownerId"], "99");
    // No description sent → field omitted.
    assert!(body.get("description").map(|d| d.is_null()).unwrap_or(true));
    let id = body["id"].as_str().unwrap();
    assert_eq!(
        members(&store, id).await,
        vec!["42".to_string(), "99".to_string()],
        "owner + creator are both members"
    );
}

#[tokio::test]
async fn auth_and_validation() {
    let Some((router, _store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    // Unauthenticated → rejected.
    let (st, _) = call(&router, None, json!({ "name": "X" })).await;
    assert_ne!(st, StatusCode::OK, "unauthenticated must be rejected");

    // Blank name → rejected.
    let (st, _) = call(&router, Some(&token("42")), json!({ "name": "   " })).await;
    assert_ne!(st, StatusCode::OK, "blank name must be rejected");
}
