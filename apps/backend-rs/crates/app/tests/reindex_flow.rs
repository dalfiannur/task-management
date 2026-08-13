//! Proves `bin/reindex` actually recovers the index: create → findable →
//! `clear_index()` (nothing findable) → run the binary → findable again.
//!
//! DESTRUCTIVE: the binary starts with `TRUNCATE search_doc`, wiping every
//! document in the shared test database — including ones a concurrently
//! running `transport::search_flow` test is relying on. `cargo test` runs
//! each test *binary* as its own process, one after another (parallelism is
//! only ever within a binary, across its own threads), so a plain `cargo test
//! --workspace` never overlaps this file with `search_flow`'s test binary and
//! needs no extra flag. The risk is only if someone runs this test binary
//! concurrently with `search_flow`'s from two separate invocations (e.g. two
//! terminals, or a test runner that parallelizes across binaries/processes
//! such as `cargo nextest`) — don't do that against the same database.
//!
//! Skipped unless `DATABASE_URL` is set.

use std::process::Command;
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
const SEARCH: &str = "/sedjiwa.tasks.search.v1.SearchService";

fn uniq() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos().to_string()
}

fn term() -> String {
    format!("zqx{}", uniq())
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
        .merge(transport::search_router(store.clone()))
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

async fn find(router: &Router, tok: &str, q: &str) -> Vec<Value> {
    let v = ok(router, &format!("{SEARCH}/Search"), tok, json!({ "q": q })).await;
    v["results"].as_array().cloned().unwrap_or_default()
}

#[tokio::test]
async fn reindex_recovers_a_cleared_index() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let database_url = std::env::var("DATABASE_URL").unwrap();

    let owner = mk_user(&store).await;
    let to = token(&owner);
    let pid = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("P{}", uniq()) }))
        .await["id"]
        .as_str()
        .unwrap()
        .to_string();
    let m = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": pid, "name": "M" }))
        .await["id"]
        .as_str()
        .unwrap()
        .to_string();

    let t = term();
    let task = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m, "title": format!("Judul {t}") }))
        .await["id"]
        .as_str()
        .unwrap()
        .to_string();

    let hits = find(&router, &to, &t).await;
    assert_eq!(hits.len(), 1, "task is findable via the write-path indexer: {hits:?}");
    assert_eq!(hits[0]["id"], task);

    // Wipe the whole index — DESTRUCTIVE, see module doc comment.
    store.clear_index().await.unwrap();
    assert!(find(&router, &to, &t).await.is_empty(), "index is now empty");

    // Run the binary against the same database.
    let output = Command::new(env!("CARGO_BIN_EXE_reindex"))
        .env("DATABASE_URL", &database_url)
        .output()
        .expect("failed to run bin/reindex");
    assert!(
        output.status.success(),
        "reindex exited non-zero: stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let hits = find(&router, &to, &t).await;
    assert_eq!(hits.len(), 1, "task is findable again after reindex: {hits:?}");
    assert_eq!(hits[0]["id"], task);
    assert_eq!(hits[0]["kind"], "TASK");
    assert_eq!(hits[0]["projectId"], pid);
}
