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

/// Call a single tool and return `(isError, the parsed JSON payload)`. Every
/// existing test up to this point inlines the `rpc` + `content[0].text`
/// parse because each only does it once or twice; the project/module tests
/// below do it repeatedly enough that the boilerplate itself starts hiding
/// what each test is actually asserting.
async fn tools_call(router: &Router, token: &str, name: &str, arguments: Value) -> (bool, Value) {
    let (_, body) = rpc(
        router,
        Some(token),
        json!({ "jsonrpc": "2.0", "id": 99, "method": "tools/call",
                "params": { "name": name, "arguments": arguments } }),
    )
    .await;
    let is_error = body["result"]["isError"].as_bool().unwrap_or(true);
    let text = body["result"]["content"][0]["text"].as_str().unwrap_or("null");
    (is_error, serde_json::from_str(text).unwrap_or(Value::Null))
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

/// Issue a PAT for a user directly through the store — its RPC path is
/// already tested separately in `transport::tokens_flow`.
async fn issue_token(store: &persistence::Store, user_id: &str) -> String {
    use domain::token::{generate_token, hash_token, preview_of, TokenInfo, TokenOwner, TokenSecret, TokenUsage};
    let t = generate_token();
    store
        .create((
            TokenSecret { hash: hash_token(&t), preview: preview_of(&t) },
            TokenOwner { user_id: user_id.to_string() },
            TokenInfo {
                name: "test".into(),
                created_at: "2026-01-01T00:00:00Z".into(),
                expires_at: None,
            },
            TokenUsage { last_used_at: None },
        ))
        .await
        .unwrap();
    t
}

/// A minimal active user — `auth_user_for` rejects anything that isn't `active`.
async fn seed_active_user(store: &persistence::Store) -> String {
    use domain::user::{UserPassword, UserPhone, UserProfile, UserStatusComponent};
    let uniq = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let pid = store
        .create((
            UserPhone { value: format!("62{uniq}"), verified: true },
            UserPassword { hash: "x".into(), changed_at: "2026-01-01T00:00:00Z".into() },
            UserProfile {
                display_name: "MCP Tester".into(),
                avatar_url: String::new(),
                email: String::new(),
            },
            UserStatusComponent {
                status: "active".into(),
                created_at: "2026-01-01T00:00:00Z".into(),
                last_login_at: None,
            },
        ))
        .await
        .unwrap();
    pid.to_string()
}

#[tokio::test]
async fn tools_list_returns_the_registry() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;

    let (st, body) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/list" }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{body:?}");
    let tools = body["result"]["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 12);
    let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert!(names.contains(&"create_task"));
    assert!(!names.contains(&"delete_task"), "delete sengaja tidak diekspos");
    for t in tools {
        assert!(t["description"].as_str().is_some_and(|d| !d.is_empty()));
        assert_eq!(t["inputSchema"]["type"], "object");
    }
}

#[tokio::test]
async fn calling_an_unknown_tool_is_invalid_params() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_, body) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 5, "method": "tools/call",
                "params": { "name": "nope", "arguments": {} } }),
    )
    .await;
    assert_eq!(body["error"]["code"], -32602);
}

#[tokio::test]
async fn business_failure_is_an_error_result_not_a_protocol_error() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (st, body) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 6, "method": "tools/call",
                "params": { "name": "get_task", "arguments": { "task_id": "999999999" } } }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert!(body.get("error").is_none(), "bukan error protokol");
    assert_eq!(body["result"]["isError"], true);
    assert!(body["result"]["content"][0]["text"].as_str().is_some());
}

#[tokio::test]
async fn create_then_get_a_task_through_mcp() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    // Project + module are seeded through store components directly, with the
    // same membership row `create_project_core` would write — that RPC path
    // is already covered by `transport::project_flow`, and this test only
    // needs data that makes `list_tasks_core`'s membership check pass.
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;

    let (_, created) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 10, "method": "tools/call",
                "params": { "name": "create_task",
                            "arguments": { "module_id": module_id, "title": "dari MCP" } } }),
    )
    .await;
    assert_eq!(created["result"]["isError"], false, "{created:?}");
    let payload: Value =
        serde_json::from_str(created["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(payload["title"], "dari MCP");
    let task_id = payload["id"].as_str().unwrap().to_string();

    let (_, fetched) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 11, "method": "tools/call",
                "params": { "name": "get_task", "arguments": { "task_id": task_id } } }),
    )
    .await;
    let payload: Value =
        serde_json::from_str(fetched["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(payload["title"], "dari MCP");
    assert_eq!(payload["status"], "todo");
}

#[tokio::test]
async fn list_tasks_resolves_project_from_module_id_alone() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;

    for title in ["one", "two"] {
        let (_, created) = rpc(
            &router,
            Some(&token),
            json!({ "jsonrpc": "2.0", "id": 20, "method": "tools/call",
                    "params": { "name": "create_task",
                                "arguments": { "module_id": module_id, "title": title } } }),
        )
        .await;
        assert_eq!(created["result"]["isError"], false, "{created:?}");
    }

    // Only `module_id` — `list_tasks` must resolve `project_id` itself
    // through `transport::api::module_project` rather than needing it passed in.
    let (_, listed) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 21, "method": "tools/call",
                "params": { "name": "list_tasks", "arguments": { "module_id": module_id } } }),
    )
    .await;
    assert_eq!(listed["result"]["isError"], false, "{listed:?}");
    let payload: Value =
        serde_json::from_str(listed["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(payload["count"], 2);
    assert_eq!(payload["tasks"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn list_tasks_without_project_or_module_is_bad_args() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;

    let (_, body) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 22, "method": "tools/call",
                "params": { "name": "list_tasks", "arguments": {} } }),
    )
    .await;
    // The caller's bug — a malformed request, not a business rule the model
    // could retry differently — so a JSON-RPC protocol error, not an
    // `isError` tool result.
    assert_eq!(body["error"]["code"], -32602, "{body:?}");
    assert!(body.get("result").is_none());
}

#[tokio::test]
async fn list_tasks_status_filter() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;

    let mut task_ids = Vec::new();
    for title in ["stays todo", "goes done"] {
        let (_, created) = rpc(
            &router,
            Some(&token),
            json!({ "jsonrpc": "2.0", "id": 23, "method": "tools/call",
                    "params": { "name": "create_task",
                                "arguments": { "module_id": module_id, "title": title } } }),
        )
        .await;
        let payload: Value =
            serde_json::from_str(created["result"]["content"][0]["text"].as_str().unwrap())
                .unwrap();
        task_ids.push(payload["id"].as_str().unwrap().to_string());
    }

    let (_, updated) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 24, "method": "tools/call",
                "params": { "name": "update_task",
                            "arguments": { "task_id": task_ids[1], "status": "done" } } }),
    )
    .await;
    assert_eq!(updated["result"]["isError"], false, "{updated:?}");

    let (_, listed) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 25, "method": "tools/call",
                "params": { "name": "list_tasks",
                            "arguments": { "module_id": module_id, "status": "done" } } }),
    )
    .await;
    let payload: Value =
        serde_json::from_str(listed["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    let tasks = payload["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 1, "{payload:?}");
    assert_eq!(tasks[0]["id"], task_ids[1]);
    assert_eq!(tasks[0]["status"], "done");
}

#[tokio::test]
async fn list_tasks_limit_caps_and_rejects_zero() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;

    for title in ["one", "two"] {
        let (_, created) = rpc(
            &router,
            Some(&token),
            json!({ "jsonrpc": "2.0", "id": 26, "method": "tools/call",
                    "params": { "name": "create_task",
                                "arguments": { "module_id": module_id, "title": title } } }),
        )
        .await;
        assert_eq!(created["result"]["isError"], false, "{created:?}");
    }

    let (_, capped) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 27, "method": "tools/call",
                "params": { "name": "list_tasks",
                            "arguments": { "module_id": module_id, "limit": 1 } } }),
    )
    .await;
    let payload: Value =
        serde_json::from_str(capped["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(payload["count"], 1, "{payload:?}");
    assert_eq!(payload["tasks"].as_array().unwrap().len(), 1);

    // `limit: 0` is a caller bug — refused, not silently clamped up to 1.
    let (_, bad) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 28, "method": "tools/call",
                "params": { "name": "list_tasks",
                            "arguments": { "module_id": module_id, "limit": 0 } } }),
    )
    .await;
    assert_eq!(bad["error"]["code"], -32602, "{bad:?}");
}

#[tokio::test]
async fn list_tasks_status_filter_rejects_unknown_value() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;

    let (_, body) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 34, "method": "tools/call",
                "params": { "name": "list_tasks",
                            "arguments": { "module_id": module_id, "status": "archived" } } }),
    )
    .await;
    // Silently matching nothing would teach the model "no such tasks" rather
    // than "bad filter value" — refused instead, same as a bad `limit`.
    assert_eq!(body["error"]["code"], -32602, "{body:?}");
    assert!(body.get("result").is_none());
}

#[tokio::test]
async fn move_task_moves_between_modules() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (project_id, module_id) = seed_project_and_module(&store, &user).await;
    let other_module_id = seed_module(&store, &project_id, "Doing").await;

    let (_, created) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 29, "method": "tools/call",
                "params": { "name": "create_task",
                            "arguments": { "module_id": module_id, "title": "to be moved" } } }),
    )
    .await;
    assert_eq!(created["result"]["isError"], false, "{created:?}");
    let payload: Value =
        serde_json::from_str(created["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(payload["module_id"], module_id);
    let task_id = payload["id"].as_str().unwrap().to_string();

    // The MCP-layer mapping under test: `task_id` → `id`, `module_id` →
    // `module_id`. A swapped field or a typo'd key would compile and pass
    // every other test in this file.
    let (_, moved) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 30, "method": "tools/call",
                "params": { "name": "move_task",
                            "arguments": { "task_id": task_id, "module_id": other_module_id } } }),
    )
    .await;
    assert_eq!(moved["result"]["isError"], false, "{moved:?}");
    let payload: Value =
        serde_json::from_str(moved["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(payload["module_id"], other_module_id);
    assert_ne!(payload["module_id"], module_id);
}

#[tokio::test]
async fn create_task_round_trips_priority_due_date_and_assignees() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;

    let (_, created) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 31, "method": "tools/call",
                "params": { "name": "create_task",
                            "arguments": {
                                "module_id": module_id,
                                "title": "with details",
                                "priority": "high",
                                "due_date": "2026-12-31",
                                // `user` is the project's seeded member (see
                                // `seed_project_and_module`), so assignment
                                // passes `validate_assignees`.
                                "assignee_ids": [user]
                            } } }),
    )
    .await;
    assert_eq!(created["result"]["isError"], false, "{created:?}");
    let payload: Value =
        serde_json::from_str(created["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(payload["priority"], "high");
    assert_eq!(payload["due_date"], "2026-12-31");
    assert_eq!(payload["assignee_ids"], json!([user]));
}

#[tokio::test]
async fn update_task_round_trips_title_description_and_priority() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;

    let (_, created) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 32, "method": "tools/call",
                "params": { "name": "create_task",
                            "arguments": { "module_id": module_id, "title": "before" } } }),
    )
    .await;
    let payload: Value =
        serde_json::from_str(created["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    let task_id = payload["id"].as_str().unwrap().to_string();

    let (_, updated) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 33, "method": "tools/call",
                "params": { "name": "update_task",
                            "arguments": {
                                "task_id": task_id,
                                "title": "after",
                                "description": "now with details",
                                "priority": "urgent"
                            } } }),
    )
    .await;
    assert_eq!(updated["result"]["isError"], false, "{updated:?}");
    let payload: Value =
        serde_json::from_str(updated["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(payload["title"], "after");
    assert_eq!(payload["description"], "now with details");
    assert_eq!(payload["priority"], "urgent");
}

/// A project (owned by `user`, with `user` as a member) + one module inside
/// it. Seeded directly through components rather than RPC.
///
/// `ProjectMembership` is its own entity per (project_id, user_id) pair —
/// creating the project does NOT make the owner a member on its own, exactly
/// as `create_project_core` writes it (see `crates/domain/src/project.rs` and
/// `projects/project_service.rs::create_project`).
///
/// Returns `(project_id, module_id)`.
async fn seed_project_and_module(store: &persistence::Store, user: &str) -> (String, String) {
    use domain::module::{ModuleDescription, ModuleName, ModuleOrder, ModuleProjectRef};
    use domain::project::{
        ProjectDates, ProjectDescription, ProjectMembership, ProjectName, ProjectOwnerId,
        ProjectStatus, ProjectStatusComponent,
    };
    let project = store
        .create((
            ProjectName { value: "MCP test project".into() },
            ProjectDescription { value: String::new() },
            ProjectOwnerId { value: user.to_string() },
            ProjectStatusComponent { value: ProjectStatus::Active.as_str().to_string() },
            ProjectDates { start_date: None, end_date: None },
        ))
        .await
        .unwrap();
    let project_id = project.to_string();
    store
        .create((ProjectMembership {
            project_id: project_id.clone(),
            user_id: user.to_string(),
        },))
        .await
        .unwrap();
    let module = store
        .create((
            ModuleName { value: "Backlog".into() },
            ModuleDescription { value: String::new() },
            ModuleProjectRef { project_id: project_id.clone() },
            ModuleOrder { value: 0 },
        ))
        .await
        .unwrap();
    (project_id, module.to_string())
}

/// A second module in an already-seeded project, for tests that need to move
/// a task between two modules in the same project.
async fn seed_module(store: &persistence::Store, project_id: &str, name: &str) -> String {
    use domain::module::{ModuleName, ModuleOrder, ModuleProjectRef};
    let module = store
        .create((
            ModuleName { value: name.to_string() },
            ModuleProjectRef { project_id: project_id.to_string() },
            ModuleOrder { value: 1 },
        ))
        .await
        .unwrap();
    module.to_string()
}

#[tokio::test]
async fn list_projects_only_shows_projects_the_user_can_see() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let member = seed_active_user(&store).await;
    let stranger = seed_active_user(&store).await;
    let (project_id, _module_id) = seed_project_and_module(&store, &member).await;

    let member_token = issue_token(&store, &member).await;
    let (is_error, mine) = tools_call(&router, &member_token, "list_projects", json!({})).await;
    assert!(!is_error, "{mine:?}");
    assert!(mine["projects"].as_array().unwrap().iter().any(|p| p["id"] == project_id.as_str()));

    let stranger_token = issue_token(&store, &stranger).await;
    let (is_error, theirs) = tools_call(&router, &stranger_token, "list_projects", json!({})).await;
    assert!(!is_error, "{theirs:?}");
    assert!(theirs["projects"].as_array().unwrap().iter().all(|p| p["id"] != project_id.as_str()));
}

#[tokio::test]
async fn list_projects_limit_is_passed_to_the_core_fn_not_just_taken_client_side() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let member = seed_active_user(&store).await;
    // 13 is deliberately more than `list_projects_core`'s own default page
    // size of 12: that boundary is exactly what let a client-side `.take()`
    // over `ListProjectsRequest::default()` hide behind — 12 results always
    // looked plausible unless a caller asked for more than 12.
    let mut project_ids = Vec::new();
    for _ in 0..13 {
        let (project_id, _module_id) = seed_project_and_module(&store, &member).await;
        project_ids.push(project_id);
    }
    let token = issue_token(&store, &member).await;

    let (is_error, all) =
        tools_call(&router, &token, "list_projects", json!({ "limit": 15 })).await;
    assert!(!is_error, "{all:?}");
    assert_eq!(all["count"], 13, "{all:?}");
    assert_eq!(all["projects"].as_array().unwrap().len(), 13);
    for id in &project_ids {
        assert!(
            all["projects"].as_array().unwrap().iter().any(|p| p["id"] == id.as_str()),
            "missing {id} from {all:?}"
        );
    }

    let (is_error, one) =
        tools_call(&router, &token, "list_projects", json!({ "limit": 1 })).await;
    assert!(!is_error, "{one:?}");
    assert_eq!(one["count"], 1, "{one:?}");
    assert_eq!(one["projects"].as_array().unwrap().len(), 1);

    // `limit: 0` collides with the core fn's own "use my default" sentinel —
    // exactly the value that made the bug possible — so it must be refused
    // by `limit_arg` before a request is ever built, same as `list_tasks`.
    let (_, body) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 40, "method": "tools/call",
                "params": { "name": "list_projects", "arguments": { "limit": 0 } } }),
    )
    .await;
    assert_eq!(body["error"]["code"], -32602, "{body:?}");
    assert!(body.get("result").is_none());
}

#[tokio::test]
async fn get_project_returns_details_for_a_member() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let member = seed_active_user(&store).await;
    let (project_id, _module_id) = seed_project_and_module(&store, &member).await;
    let token = issue_token(&store, &member).await;

    let (is_error, payload) =
        tools_call(&router, &token, "get_project", json!({ "project_id": project_id })).await;
    assert!(!is_error, "{payload:?}");
    assert_eq!(payload["id"], project_id.as_str());
    assert_eq!(payload["name"], "MCP test project");
    // `seed_project_and_module` writes the owner as `member` and status Active
    // — this is the argument-to-field mapping under test: `p.status` (a wire
    // enum) must come back as the string label, not the raw code, and
    // `p.owner_id` must land under `owner_id`.
    assert_eq!(payload["status"], "active");
    assert_eq!(payload["owner_id"], member.as_str());
}

#[tokio::test]
async fn get_project_refuses_a_non_member() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let member = seed_active_user(&store).await;
    let stranger = seed_active_user(&store).await;
    let (project_id, _module_id) = seed_project_and_module(&store, &member).await;
    let stranger_token = issue_token(&store, &stranger).await;

    let (is_error, payload) = tools_call(
        &router,
        &stranger_token,
        "get_project",
        json!({ "project_id": project_id }),
    )
    .await;
    // `get_project_core`'s own membership check rejects this — a business
    // rule the model could read and stop retrying, not a malformed request —
    // so an `isError` tool result rather than a JSON-RPC protocol error.
    assert!(is_error, "{payload:?}");
}

#[tokio::test]
async fn list_modules_returns_a_projects_modules() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let member = seed_active_user(&store).await;
    let (project_id, module_id) = seed_project_and_module(&store, &member).await;
    let other_module_id = seed_module(&store, &project_id, "Doing").await;
    let token = issue_token(&store, &member).await;

    let (is_error, payload) =
        tools_call(&router, &token, "list_modules", json!({ "project_id": project_id })).await;
    assert!(!is_error, "{payload:?}");
    assert_eq!(payload["count"], 2, "{payload:?}");
    let modules = payload["modules"].as_array().unwrap();
    assert_eq!(modules.len(), 2);

    let backlog = modules.iter().find(|m| m["id"] == module_id.as_str()).unwrap();
    assert_eq!(backlog["name"], "Backlog");
    assert_eq!(backlog["order"], 0);
    // `Module` carries no `project_id` on the wire — the tool echoes back the
    // id it was asked about instead. This is the mapping most likely to
    // silently regress: the task file's own draft claimed a `m.project_id`
    // field that does not exist on the proto.
    assert_eq!(backlog["project_id"], project_id.as_str());

    let doing = modules.iter().find(|m| m["id"] == other_module_id.as_str()).unwrap();
    assert_eq!(doing["name"], "Doing");
    assert_eq!(doing["order"], 1);
    assert_eq!(doing["project_id"], project_id.as_str());
}
