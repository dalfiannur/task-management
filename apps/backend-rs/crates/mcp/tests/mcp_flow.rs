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

fn uniq() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos().to_string()
}

/// Seed a user plus one token for it. Returns (user pid, token pid, plaintext).
///
/// Bypasses the Connect services and writes ECS components directly, but the
/// shape must still match what `CreateToken` actually produces — including
/// the `TokenUsage` component, which `touch()` would otherwise insert lazily
/// on first use. Seeding a shape production never emits would make the
/// fixture quietly test something else.
async fn seed_user_with_token(
    store: &persistence::Store,
    status: domain::user::UserStatus,
    expires_at: Option<String>,
) -> (i64, i64, String) {
    let now = "2026-01-01T00:00:00Z".to_string();
    let uid = store
        .create((
            domain::user::UserPhone {
                value: format!("+1555{}", uniq()),
                verified: true,
            },
            domain::user::UserPassword {
                hash: "unused-in-this-test".into(),
                changed_at: now.clone(),
            },
            domain::user::UserProfile {
                display_name: "MCP Test User".into(),
                avatar_url: String::new(),
                email: String::new(),
            },
            domain::user::UserStatusComponent {
                status: status.as_str().to_string(),
                created_at: now.clone(),
                last_login_at: None,
            },
        ))
        .await
        .unwrap();

    let plaintext = domain::token::generate_token();
    let tid = store
        .create((
            domain::token::TokenSecret {
                hash: domain::token::hash_token(&plaintext),
                preview: domain::token::preview_of(&plaintext),
            },
            domain::token::TokenOwner {
                user_id: uid.to_string(),
            },
            domain::token::TokenInfo {
                name: "mcp-flow-test".into(),
                created_at: now,
                expires_at,
            },
            domain::token::TokenUsage { last_used_at: None },
        ))
        .await
        .unwrap();
    (uid, tid, plaintext)
}

/// Insert an active user and a real PAT owned by them, and return the
/// plaintext token. Now that the MCP endpoint requires auth for every
/// non-handshake method, `unknown_method_is_a_jsonrpc_error` needs a real
/// credential to even reach method dispatch — a missing/bad token would
/// short-circuit to 401 before the method is ever looked at.
async fn seed_authed_user(store: &persistence::Store) -> String {
    seed_user_with_token(store, domain::user::UserStatus::Active, None)
        .await
        .2
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
    let Some((router, store)) = router_and_store().await else { return skipped() };
    // A non-handshake method needs a valid token to even reach dispatch, so
    // this exercises method-not-found under a real credential.
    let token = seed_authed_user(&store).await;
    let (st, body) = rpc(
        &router,
        Some(&token),
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

#[tokio::test]
async fn tools_list_without_token_is_401() {
    let Some(router) = router().await else { return skipped() };
    let req = Request::builder()
        .method("POST")
        .uri("/mcp")
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }).to_string(),
        ))
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    // Bad credentials are distinguished from a bad request: 401 +
    // WWW-Authenticate, not a JSON-RPC error, so the client knows it's a
    // token problem.
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    assert!(resp.headers().get("www-authenticate").is_some());
}

#[tokio::test]
async fn garbage_token_is_401() {
    let Some(router) = router().await else { return skipped() };
    let (st, _) = rpc(
        &router,
        Some("not-a-real-token"),
        json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/list" }),
    )
    .await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn expired_token_is_refused() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let (_, _, token) = seed_user_with_token(
        &store,
        domain::user::UserStatus::Active,
        Some("2020-01-01T00:00:00Z".into()),
    )
    .await;
    let (st, _) = rpc(&router, Some(&token), json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/list"
    }))
    .await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn suspended_users_token_is_refused() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    // The token itself is perfectly valid. What changed is the user behind it —
    // which is exactly why permissions are read fresh instead of baked into the
    // token at issue time.
    let (_, _, token) =
        seed_user_with_token(&store, domain::user::UserStatus::Suspended, None).await;
    let (st, _) = rpc(&router, Some(&token), json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/list"
    }))
    .await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn revoked_token_is_refused() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let (_, tid, token) =
        seed_user_with_token(&store, domain::user::UserStatus::Active, None).await;
    store.delete(tid).await.unwrap();
    let (st, _) = rpc(&router, Some(&token), json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/list"
    }))
    .await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

/// Every way of failing must look the same from outside. A response that says
/// "expired" where another says "unknown" tells someone guessing that their
/// guess was nearly right.
#[tokio::test]
async fn every_rejection_is_indistinguishable() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let (_, tid, revoked) =
        seed_user_with_token(&store, domain::user::UserStatus::Active, None).await;
    store.delete(tid).await.unwrap();
    let (_, _, expired) = seed_user_with_token(
        &store,
        domain::user::UserStatus::Active,
        Some("2020-01-01T00:00:00Z".into()),
    )
    .await;
    let (_, _, suspended) =
        seed_user_with_token(&store, domain::user::UserStatus::Suspended, None).await;

    let req = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" });
    let mut seen = Vec::new();
    for bearer in [
        None,
        Some("not-a-token"),
        Some("sjw_pat_0000000000000000000000000000000000000000000000000000000000000000"),
        Some(revoked.as_str()),
        Some(expired.as_str()),
        Some(suspended.as_str()),
    ] {
        seen.push(rpc(&router, bearer, req.clone()).await);
    }
    let first = &seen[0];
    assert_eq!(first.0, StatusCode::UNAUTHORIZED);
    for (i, other) in seen.iter().enumerate().skip(1) {
        assert_eq!(other, first, "rejection {i} is distinguishable from the first");
    }
}
