//! End-to-end MCP endpoint.
//!
//! Every test here needs `DATABASE_URL`, including the handshake ones: building the
//! router needs a `Store` even though the handshake never reads it. Without the
//! variable each test returns early, and cargo reports that as a pass — so the skip
//! prints a marker rather than vanishing. A run that prints nothing is a run that
//! tested something.

use axum::body::{to_bytes, Body};
use axum::extract::Request;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::StatusCode;
use axum::Router;
use serde_json::{json, Value};
use std::sync::Arc;
use tower::ServiceExt;

async fn router_and_store() -> Option<(Router, Arc<persistence::Store>)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let store = Arc::new(
        persistence::Store::connect(&url, domain::register_all)
            .await
            .unwrap(),
    );
    let notifier = Arc::new(transport::Notifier::new());
    let router = Router::new().nest("/mcp", mcp::mcp_router(store.clone(), notifier));
    Some((router, store))
}

/// Tests that don't touch the store only need the router.
async fn router() -> Option<Router> {
    Some(router_and_store().await?.0)
}

/// Say so, loudly, when a test is about to no-op. Cargo counts an early return as a
/// pass, so silence here is indistinguishable from success.
fn skipped() {
    // A test's thread carries its own name, so the marker names itself.
    let name = std::thread::current().name().unwrap_or("test").to_string();
    eprintln!("SKIP {name}: DATABASE_URL is not set, this test asserted nothing");
}

async fn rpc(router: &Router, bearer: Option<&str>, body: Value) -> (StatusCode, Value) {
    let mut b = Request::builder()
        .method("POST")
        .uri("/mcp")
        .header(CONTENT_TYPE, "application/json");
    if let Some(t) = bearer {
        b = b.header(AUTHORIZATION, format!("Bearer {t}"));
    }
    let req = b.body(Body::from(body.to_string())).unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[tokio::test]
async fn initialize_returns_capabilities() {
    let Some(router) = router().await else { return skipped() };
    let (st, body) = rpc(
        &router,
        None,
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": { "protocolVersion": "2025-06-18", "capabilities": {} }
        }),
    )
    .await;
    // The handshake needs no credentials — a client must be able to discover
    // the server before the user pastes in a token.
    assert_eq!(st, StatusCode::OK, "{body:?}");
    assert_eq!(body["jsonrpc"], "2.0");
    assert_eq!(body["id"], 1);
    assert!(body["result"]["capabilities"]["tools"].is_object());
    assert_eq!(body["result"]["serverInfo"]["name"], "sedjiwa-tasks");
}

#[tokio::test]
async fn ping_is_answered_without_credentials() {
    let Some(router) = router().await else { return skipped() };
    let (st, body) = rpc(
        &router,
        None,
        json!({ "jsonrpc": "2.0", "id": 2, "method": "ping" }),
    )
    .await;
    // ping is the other credential-free method — a client uses it to check the
    // server is alive before it has a token to send.
    assert_eq!(st, StatusCode::OK, "{body:?}");
    assert_eq!(body["jsonrpc"], "2.0");
    assert_eq!(body["id"], 2);
    assert!(body["result"].is_object());
}

#[tokio::test]
async fn notification_gets_202_and_no_body() {
    let Some(router) = router().await else { return skipped() };
    let req = Request::builder()
        .method("POST")
        .uri("/mcp")
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }).to_string(),
        ))
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::ACCEPTED);
}

#[tokio::test]
async fn unknown_method_is_a_jsonrpc_error() {
    let Some(router) = router().await else { return skipped() };
    let (st, body) = rpc(
        &router,
        None,
        json!({ "jsonrpc": "2.0", "id": 9, "method": "does/not/exist" }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["error"]["code"], -32601);
}

#[tokio::test]
async fn malformed_json_is_a_parse_error() {
    let Some(router) = router().await else { return skipped() };
    let req = Request::builder()
        .method("POST")
        .uri("/mcp")
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from("{ not json"))
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["error"]["code"], -32700);
}

#[tokio::test]
async fn valid_json_that_is_not_jsonrpc_is_an_invalid_request() {
    let Some(router) = router().await else { return skipped() };
    // Well-formed JSON, but missing the required `method` field — a client
    // request-builder bug, not a transport failure, so it must not collapse
    // into the same -32700 as truly malformed JSON.
    let (st, body) = rpc(&router, None, json!({ "jsonrpc": "2.0", "id": 1 })).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["error"]["code"], -32600);
    assert_eq!(body["id"], 1);
}

#[tokio::test]
async fn get_is_not_supported() {
    let Some(router) = router().await else { return skipped() };
    let req = Request::builder().method("GET").uri("/mcp").body(Body::empty()).unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::METHOD_NOT_ALLOWED);
}
