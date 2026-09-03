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
///
/// Blind spot: a JSON-RPC *protocol* error (bad args, unknown tool — no
/// `result` at all, only `error`) reads back here as `(true, Value::Null)`,
/// the exact same shape as a genuine business `isError` result with an
/// unparseable payload. A test that means to assert a protocol rejection
/// specifically must not rely on this helper's `true` — it would pass either
/// way and silently lose the distinction. Assert `body["error"]["code"]`
/// through the raw `rpc()` call instead (see e.g.
/// `calling_an_unknown_tool_is_invalid_params`).
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
async fn create_task_rejects_a_misspelled_priority() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;

    let (_, body) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 35, "method": "tools/call",
                "params": { "name": "create_task",
                            "arguments": {
                                "module_id": module_id,
                                "title": "typo'd priority",
                                "priority": "critial"
                            } } }),
    )
    .await;
    // Without validation, `create_task_core` would silently accept `critial`
    // as "no priority" and create the task anyway — a typo must fail the
    // same way it does through `update_task`, not disappear.
    assert_eq!(body["error"]["code"], -32602, "{body:?}");
    assert!(body.get("result").is_none());
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

/// Create a task through the tool and return its id. Every subtask test below
/// needs at least two of these, and the two-step json/parse dance is the same
/// each time.
async fn create_task_via_tool(router: &Router, token: &str, args: Value) -> String {
    let (_, created) = rpc(
        router,
        Some(token),
        json!({ "jsonrpc": "2.0", "id": 90, "method": "tools/call",
                "params": { "name": "create_task", "arguments": args } }),
    )
    .await;
    assert_eq!(created["result"]["isError"], false, "{created:?}");
    let payload: Value =
        serde_json::from_str(created["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    payload["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn create_task_makes_a_subtask_in_its_parents_module() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (project_id, module_id) = seed_project_and_module(&store, &user).await;
    let other_module_id = seed_module(&store, &project_id, "elsewhere").await;

    let parent = create_task_via_tool(
        &router,
        &token,
        json!({ "module_id": module_id, "title": "parent" }),
    )
    .await;

    // Deliberately point the child at a *different* module. A subtask lives in
    // its parent's module, so the argument must be overridden rather than
    // honoured — asserting on the parent's module is what proves that, and it
    // would pass by accident if both ids were the same.
    let (_, created) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 91, "method": "tools/call",
                "params": { "name": "create_task",
                            "arguments": {
                                "module_id": other_module_id,
                                "title": "child",
                                "parent_id": parent
                            } } }),
    )
    .await;
    assert_eq!(created["result"]["isError"], false, "{created:?}");
    let payload: Value =
        serde_json::from_str(created["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(payload["parent_id"], parent);
    assert_eq!(payload["module_id"], module_id);
    assert_ne!(payload["module_id"], other_module_id);
}

#[tokio::test]
async fn create_task_refuses_to_nest_a_subtask_under_a_subtask() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;

    let parent = create_task_via_tool(
        &router,
        &token,
        json!({ "module_id": module_id, "title": "parent" }),
    )
    .await;
    let child = create_task_via_tool(
        &router,
        &token,
        json!({ "module_id": module_id, "title": "child", "parent_id": parent }),
    )
    .await;

    let (_, body) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 92, "method": "tools/call",
                "params": { "name": "create_task",
                            "arguments": {
                                "module_id": module_id,
                                "title": "grandchild",
                                "parent_id": child
                            } } }),
    )
    .await;
    // One level deep is a core rule, and it reaches the model as a readable
    // business error rather than a protocol error: the model can pick a
    // different parent and retry.
    assert_eq!(body["result"]["isError"], true, "{body:?}");
    let text = body["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("subtask"), "{text}");
}

#[tokio::test]
async fn update_task_sets_detaches_and_leaves_the_parent_alone() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;

    let parent = create_task_via_tool(
        &router,
        &token,
        json!({ "module_id": module_id, "title": "parent" }),
    )
    .await;
    let task = create_task_via_tool(
        &router,
        &token,
        json!({ "module_id": module_id, "title": "standalone" }),
    )
    .await;

    let update = |args: Value| {
        let router = &router;
        let token = &token;
        async move {
            let (_, updated) = rpc(
                router,
                Some(token),
                json!({ "jsonrpc": "2.0", "id": 93, "method": "tools/call",
                        "params": { "name": "update_task", "arguments": args } }),
            )
            .await;
            assert_eq!(updated["result"]["isError"], false, "{updated:?}");
            serde_json::from_str::<Value>(
                updated["result"]["content"][0]["text"].as_str().unwrap(),
            )
            .unwrap()
        }
    };

    // A string sets the parent.
    let payload = update(json!({ "task_id": task, "parent_id": parent })).await;
    assert_eq!(payload["parent_id"], parent);

    // Omitting it leaves the parent alone. This is the state a regression is
    // most likely to break — reading "absent" as "detach" would quietly
    // unparent every task the model touches for an unrelated edit — and
    // nothing else here would catch it.
    let payload = update(json!({ "task_id": task, "title": "renamed" })).await;
    assert_eq!(payload["title"], "renamed");
    assert_eq!(payload["parent_id"], parent);

    // Explicit null detaches back to top level.
    let payload = update(json!({ "task_id": task, "parent_id": Value::Null })).await;
    assert_eq!(payload["parent_id"], Value::Null);
}

#[tokio::test]
async fn update_task_rejects_an_unusable_parent_id() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;

    let task = create_task_via_tool(
        &router,
        &token,
        json!({ "module_id": module_id, "title": "subject" }),
    )
    .await;

    // An empty string would read as "not supplied" through `opt_str`, so a
    // caller meaning to detach would silently change nothing. Refused, with
    // the alternative named.
    let (_, empty) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 94, "method": "tools/call",
                "params": { "name": "update_task",
                            "arguments": { "task_id": task, "parent_id": "" } } }),
    )
    .await;
    assert_eq!(empty["error"]["code"], -32602, "{empty:?}");
    assert!(empty["error"]["message"]
        .as_str()
        .unwrap()
        .contains("null"), "{empty:?}");

    // A wrong-typed value is a caller bug, not a business rule.
    let (_, wrong_type) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 95, "method": "tools/call",
                "params": { "name": "update_task",
                            "arguments": { "task_id": task, "parent_id": 7 } } }),
    )
    .await;
    assert_eq!(wrong_type["error"]["code"], -32602, "{wrong_type:?}");
    assert!(wrong_type.get("result").is_none());
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

#[tokio::test]
async fn search_finds_a_task_and_maps_result_fields() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (project_id, module_id) = seed_project_and_module(&store, &user).await;

    let (err, created) = tools_call(
        &router,
        &token,
        "create_task",
        json!({ "module_id": module_id, "title": "unikorn tunggangan naga" }),
    )
    .await;
    assert!(!err, "{created:?}");
    let task_id = created["id"].as_str().unwrap().to_string();

    let (err, found) =
        tools_call(&router, &token, "search", json!({ "query": "unikorn" })).await;
    assert!(!err, "{found:?}");
    let results = found["results"].as_array().unwrap();
    let hit = results.iter().find(|r| r["id"] == task_id.as_str()).unwrap();
    // `SearchResult.kind` is a wire enum and must come back as a string label
    // (not the raw code), and `.id`/`.project_id` are the real field names —
    // the task file's own draft guessed `entity_id`.
    assert_eq!(hit["kind"], "task");
    assert_eq!(hit["title"], "unikorn tunggangan naga");
    assert_eq!(hit["project_id"], project_id.as_str());
}

#[tokio::test]
async fn search_limit_is_passed_to_the_core_fn_not_just_taken_client_side() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;

    // 21 is deliberately more than `search_core`'s own default of 20 (its
    // `limit == 0` sentinel): that boundary is exactly what a client-side
    // `.take()` over `SearchRequest::default()` (`limit: 0`) would hide
    // behind — 20 results always looks plausible unless a caller asks for
    // more than 20.
    for i in 0..21 {
        let (err, _) = tools_call(
            &router,
            &token,
            "create_task",
            json!({ "module_id": module_id, "title": format!("gajahmada-{i}") }),
        )
        .await;
        assert!(!err);
    }

    let (err, all) =
        tools_call(&router, &token, "search", json!({ "query": "gajahmada", "limit": 21 })).await;
    assert!(!err, "{all:?}");
    assert_eq!(all["count"], 21, "{all:?}");

    // `limit: 0` collides with `search_core`'s own "use my default" sentinel
    // — exactly the value that made the bug possible — so it must be refused
    // by `limit_arg` before a request is ever built, same as `list_projects`.
    let (_, body) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 50, "method": "tools/call",
                "params": { "name": "search", "arguments": { "query": "gajahmada", "limit": 0 } } }),
    )
    .await;
    assert_eq!(body["error"]["code"], -32602, "{body:?}");
    assert!(body.get("result").is_none());
}

#[tokio::test]
async fn search_limit_above_the_servers_own_cap_is_refused() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;

    // `search`'s `inputSchema` advertises `maximum: 50`, but `tools/call`
    // never validates arguments against that schema — nothing does. The
    // handler itself has to refuse a `limit` above the cap via
    // `limit_arg_capped`; without that, a client that ignores the schema (or
    // a model that miscounts) would sail past the shared `limit_arg`'s
    // `1..=200` range with `limit: 75`, reach `search_core`, and get back at
    // most 50 results with no signal that it was ever truncated.
    let (_, body) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 51, "method": "tools/call",
                "params": { "name": "search", "arguments": { "query": "anything", "limit": 75 } } }),
    )
    .await;
    assert_eq!(body["error"]["code"], -32602, "{body:?}");
    assert!(body.get("result").is_none());
}

#[tokio::test]
async fn search_result_for_a_comment_carries_its_parent_task_id() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;

    let (err, task) = tools_call(&router, &token, "create_task",
        json!({ "module_id": module_id, "title": "tugas dengan komentar" })).await;
    assert!(!err, "{task:?}");
    let task_id = task["id"].as_str().unwrap().to_string();

    // Posted through the real `add_comment` tool (Task 13), not a hand-rolled
    // substitute for it — this exercises the real indexing path
    // (`search_core`'s dedicated comment→task lookup) end to end from the
    // same MCP surface a client actually calls.
    let (err, _) = tools_call(
        &router,
        &token,
        "add_comment",
        json!({ "task_id": task_id, "content": "membahas kadal raksasa" }),
    )
    .await;
    assert!(!err);

    let (err, found) =
        tools_call(&router, &token, "search", json!({ "query": "kadal" })).await;
    assert!(!err, "{found:?}");
    let results = found["results"].as_array().unwrap();
    let hit = results.iter().find(|r| r["kind"] == "comment").unwrap();
    // A comment hit's own `title` is empty — `task_id` is what actually
    // makes the result actionable, and it must be the parent task's id, not
    // dropped or left null.
    assert_eq!(hit["task_id"], task_id.as_str(), "{hit:?}");

    // The other half of the round trip discovery.rs's doc comment promises:
    // a model that found this comment via `search` can follow `task_id`
    // straight into `list_comments` and land on the same comment.
    let (err, listed) =
        tools_call(&router, &token, "list_comments", json!({ "task_id": task_id })).await;
    assert!(!err, "{listed:?}");
    assert!(listed["comments"]
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c["content"] == "membahas kadal raksasa"));
}

#[tokio::test]
async fn my_tasks_returns_only_assigned_work() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;

    let (err, _) = tools_call(&router, &token, "create_task",
        json!({ "module_id": module_id, "title": "punya saya", "assignee_ids": [user.clone()] })).await;
    assert!(!err);
    let (err, _) = tools_call(&router, &token, "create_task",
        json!({ "module_id": module_id, "title": "tanpa assignee" })).await;
    assert!(!err);

    let (err, mine) = tools_call(&router, &token, "my_tasks", json!({})).await;
    assert!(!err);
    let titles: Vec<&str> = mine["tasks"].as_array().unwrap()
        .iter().map(|t| t["title"].as_str().unwrap()).collect();
    assert!(titles.contains(&"punya saya"));
    assert!(!titles.contains(&"tanpa assignee"));
}

/// The real test that a `scope` argument routes to three genuinely different
/// core fns instead of always calling the same one: three tasks, each
/// connected to `worker` through exactly one relationship (assigned, created,
/// or discussed), and each `scope` value must surface exactly its own task
/// and no other.
#[tokio::test]
async fn my_tasks_scope_routes_to_three_different_core_fns() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let creator = seed_active_user(&store).await;
    let worker = seed_active_user(&store).await;
    let (project_id, module_id) = seed_project_and_module(&store, &creator).await;
    // `worker` needs project membership too: create_task_core requires
    // assignees to be project members, and `scoped_tasks()` (behind every
    // `MyTasksService` RPC) only ever considers the caller's member projects.
    store
        .create((domain::project::ProjectMembership {
            project_id: project_id.clone(),
            user_id: worker.clone(),
        },))
        .await
        .unwrap();

    let creator_token = issue_token(&store, &creator).await;
    let worker_token = issue_token(&store, &worker).await;

    // Assigned-only: creator opens it, assigns worker.
    let (err, assigned_task) = tools_call(&router, &creator_token, "create_task", json!({
        "module_id": module_id, "title": "assigned to worker",
        "assignee_ids": [worker.clone()]
    })).await;
    assert!(!err, "{assigned_task:?}");

    // Created-only: worker opens it themself, assigns no one.
    let (err, created_task) = tools_call(&router, &worker_token, "create_task", json!({
        "module_id": module_id, "title": "created by worker"
    })).await;
    assert!(!err, "{created_task:?}");

    // Involving-only: creator opens and owns it, worker neither assigned nor
    // creator — only connected by commenting on it. Seeded directly as a
    // `CommentInfo` component since `add_comment` isn't an MCP tool yet
    // (Task 13); the shape must match what that RPC will eventually write.
    let (err, involving_task) = tools_call(&router, &creator_token, "create_task", json!({
        "module_id": module_id, "title": "discussed with worker"
    })).await;
    assert!(!err, "{involving_task:?}");
    let involving_task_id = involving_task["id"].as_str().unwrap().to_string();
    store
        .create((domain::comment::CommentInfo {
            task_id: involving_task_id.clone(),
            author_id: worker.clone(),
            content: "menandai diri sendiri".into(),
            mentioned_user_ids: vec![],
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        },))
        .await
        .unwrap();

    let titles_for = |body: &Value| -> Vec<String> {
        body["tasks"].as_array().unwrap()
            .iter().map(|t| t["title"].as_str().unwrap().to_string()).collect()
    };

    let (err, assigned) =
        tools_call(&router, &worker_token, "my_tasks", json!({ "scope": "assigned" })).await;
    assert!(!err, "{assigned:?}");
    let assigned_titles = titles_for(&assigned);
    assert!(assigned_titles.contains(&"assigned to worker".to_string()), "{assigned_titles:?}");
    assert!(!assigned_titles.contains(&"created by worker".to_string()), "{assigned_titles:?}");
    assert!(!assigned_titles.contains(&"discussed with worker".to_string()), "{assigned_titles:?}");
    // `MyTask` carries the project/module context alongside the task, so a
    // second `get_project` call isn't needed to place it.
    let hit = assigned["tasks"].as_array().unwrap()
        .iter().find(|t| t["title"] == "assigned to worker").unwrap();
    assert_eq!(hit["project_id"], project_id.as_str());
    assert_eq!(hit["project_name"], "MCP test project");
    assert_eq!(hit["module_name"], "Backlog");

    let (err, created) =
        tools_call(&router, &worker_token, "my_tasks", json!({ "scope": "created" })).await;
    assert!(!err, "{created:?}");
    let created_titles = titles_for(&created);
    assert!(!created_titles.contains(&"assigned to worker".to_string()), "{created_titles:?}");
    assert!(created_titles.contains(&"created by worker".to_string()), "{created_titles:?}");
    assert!(!created_titles.contains(&"discussed with worker".to_string()), "{created_titles:?}");

    let (err, involving) =
        tools_call(&router, &worker_token, "my_tasks", json!({ "scope": "involving" })).await;
    assert!(!err, "{involving:?}");
    let involving_titles = titles_for(&involving);
    assert!(!involving_titles.contains(&"assigned to worker".to_string()), "{involving_titles:?}");
    // `involving` means discussion, not ownership: it must NOT pick up
    // "created by worker" just because worker created that task — only the
    // task worker actually commented on belongs here.
    assert!(!involving_titles.contains(&"created by worker".to_string()), "{involving_titles:?}");
    assert!(involving_titles.contains(&"discussed with worker".to_string()), "{involving_titles:?}");

    // Sanity: an unknown scope is a caller bug, not silently "assigned" — a
    // `BadArgs` (JSON-RPC protocol error), not a business `isError` result.
    // Using `tools_call` here would report `(true, Value::Null)` for either
    // shape (see its doc comment), so this asserts the real error code
    // through the raw `rpc()` call instead.
    let (_, body) = rpc(
        &router,
        Some(&worker_token),
        json!({ "jsonrpc": "2.0", "id": 60, "method": "tools/call",
                "params": { "name": "my_tasks", "arguments": { "scope": "bogus" } } }),
    )
    .await;
    assert_eq!(body["error"]["code"], -32602, "{body:?}");
    assert!(body.get("result").is_none());
}

#[tokio::test]
async fn my_tasks_status_filter_is_validated_and_pushed_to_the_core_fn() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;

    let (err, todo_task) = tools_call(&router, &token, "create_task", json!({
        "module_id": module_id, "title": "belum dikerjakan", "assignee_ids": [user.clone()]
    })).await;
    assert!(!err, "{todo_task:?}");
    let (err, done_task) = tools_call(&router, &token, "create_task", json!({
        "module_id": module_id, "title": "selesai", "assignee_ids": [user.clone()]
    })).await;
    assert!(!err, "{done_task:?}");
    let (err, _) = tools_call(&router, &token, "update_task", json!({
        "task_id": done_task["id"], "status": "done"
    })).await;
    assert!(!err);

    let (err, filtered) =
        tools_call(&router, &token, "my_tasks", json!({ "status": "done" })).await;
    assert!(!err, "{filtered:?}");
    let titles: Vec<&str> = filtered["tasks"].as_array().unwrap()
        .iter().map(|t| t["title"].as_str().unwrap()).collect();
    assert_eq!(titles, vec!["selesai"], "{filtered:?}");

    // A typo'd status is a caller bug, refused rather than silently matching
    // nothing (the same rule `list_tasks` enforces).
    let (_, body) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 61, "method": "tools/call",
                "params": { "name": "my_tasks", "arguments": { "status": "archived" } } }),
    )
    .await;
    assert_eq!(body["error"]["code"], -32602, "{body:?}");
}

#[tokio::test]
async fn add_then_list_comments_round_trips_author_and_mentions() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let author = seed_active_user(&store).await;
    let member = seed_active_user(&store).await;
    let stranger = seed_active_user(&store).await;
    let (project_id, module_id) = seed_project_and_module(&store, &author).await;
    // `member` needs to actually be a project member for the mention to
    // survive `create_comment_core`'s `filter_mentions` — membership is what
    // that filter keys on, not merely "is a user that exists".
    store
        .create((domain::project::ProjectMembership {
            project_id: project_id.clone(),
            user_id: member.clone(),
        },))
        .await
        .unwrap();
    let token = issue_token(&store, &author).await;

    let (_, task) = tools_call(
        &router,
        &token,
        "create_task",
        json!({ "module_id": module_id, "title": "berkomentar" }),
    )
    .await;
    let task_id = task["id"].as_str().unwrap().to_string();

    let (err, added) = tools_call(
        &router,
        &token,
        "add_comment",
        json!({
            "task_id": task_id,
            "content": "laporan dari AI",
            // `member` is a real project member and stays; `stranger` is not
            // and must be dropped, per `create_comment_core`'s own
            // `filter_mentions` — this is the mapping under test.
            "mentioned_user_ids": [member.clone(), stranger.clone()]
        }),
    )
    .await;
    assert!(!err, "{added:?}");
    assert_eq!(added["task_id"], task_id.as_str());
    assert_eq!(added["mentioned_user_ids"], json!([member.clone()]), "{added:?}");

    let (err, listed) =
        tools_call(&router, &token, "list_comments", json!({ "task_id": task_id })).await;
    assert!(!err, "{listed:?}");
    assert_eq!(listed["count"], 1, "{listed:?}");
    assert_eq!(listed["total"], 1, "{listed:?}");
    let row = &listed["comments"][0];
    assert_eq!(row["content"], "laporan dari AI");
    // `author_id` must be the token's own owner, not something the caller
    // could supply — `create_comment_core` sets it from `auth.id`, never
    // from the request body.
    assert_eq!(row["author_id"], author.as_str());
    assert_eq!(row["mentioned_user_ids"], json!([member.as_str()]));
}

#[tokio::test]
async fn list_comments_and_add_comment_refuse_a_non_member() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let member = seed_active_user(&store).await;
    let stranger = seed_active_user(&store).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &member).await;
    let member_token = issue_token(&store, &member).await;
    let stranger_token = issue_token(&store, &stranger).await;

    let (_, task) = tools_call(
        &router,
        &member_token,
        "create_task",
        json!({ "module_id": module_id, "title": "khusus anggota" }),
    )
    .await;
    let task_id = task["id"].as_str().unwrap().to_string();

    // Both tools are member-gated through the same `require_member` the task
    // itself uses — a business rule the model can read and stop retrying, so
    // this must land as a tool-result `isError`, not a JSON-RPC protocol
    // error. `tools_call`'s own doc comment warns that a protocol error and
    // a business `isError` look identical through its `(bool, Value)`
    // return, so the raw `rpc()` body is asserted directly instead of
    // trusting that helper's `true` for this specific distinction.
    let (st, body) = rpc(
        &router,
        Some(&stranger_token),
        json!({ "jsonrpc": "2.0", "id": 70, "method": "tools/call",
                "params": { "name": "list_comments", "arguments": { "task_id": task_id } } }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert!(body.get("error").is_none(), "bukan error protokol: {body:?}");
    assert_eq!(body["result"]["isError"], true, "{body:?}");

    let (st, body) = rpc(
        &router,
        Some(&stranger_token),
        json!({ "jsonrpc": "2.0", "id": 71, "method": "tools/call",
                "params": { "name": "add_comment",
                            "arguments": { "task_id": task_id, "content": "menyusup" } } }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert!(body.get("error").is_none(), "bukan error protokol: {body:?}");
    assert_eq!(body["result"]["isError"], true, "{body:?}");
}

#[tokio::test]
async fn list_comments_limit_is_passed_to_the_core_fn_not_just_taken_client_side() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;
    let (_, task) = tools_call(
        &router,
        &token,
        "create_task",
        json!({ "module_id": module_id, "title": "banyak komentar" }),
    )
    .await;
    let task_id = task["id"].as_str().unwrap().to_string();

    // 51 is deliberately more than `list_comments_core`'s own default page
    // size of 50 (its `page_size == 0` sentinel): that boundary is exactly
    // what a client-side `.take()` over `ListCommentsRequest::default()`
    // would hide behind, the same trap `list_projects`/`search` already
    // guard against. Seeded straight through `create_comment_core` rather
    // than 51 `add_comment` round trips through the router — this test is
    // about `list_comments`'s request-building, not `add_comment`'s, which
    // `add_then_list_comments_round_trips_author_and_mentions` already
    // covers.
    let auth = transport::api::auth_user_for(&store, &user).await.unwrap().unwrap();
    for i in 0..51 {
        transport::api::create_comment_core(
            &store,
            None,
            &auth,
            transport::api::comment_pb::CreateCommentRequest {
                task_id: task_id.clone(),
                content: format!("komentar {i}"),
                mentioned_user_ids: vec![],
            },
        )
        .await
        .unwrap();
    }

    let (err, all) = tools_call(
        &router,
        &token,
        "list_comments",
        json!({ "task_id": task_id, "limit": 51 }),
    )
    .await;
    assert!(!err, "{all:?}");
    assert_eq!(all["count"], 51, "{all:?}");
    assert_eq!(all["total"], 51, "{all:?}");
    assert_eq!(all["comments"].as_array().unwrap().len(), 51);

    // `limit: 0` collides with the core fn's own "use my default" sentinel —
    // exactly the value that made the bug possible — so it must be refused
    // by `limit_arg` before a request is ever built, same as `list_projects`
    // and `search`.
    let (_, body) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 72, "method": "tools/call",
                "params": { "name": "list_comments",
                            "arguments": { "task_id": task_id, "limit": 0 } } }),
    )
    .await;
    assert_eq!(body["error"]["code"], -32602, "{body:?}");
    assert!(body.get("result").is_none());
}
