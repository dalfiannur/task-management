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
        persistence::Store::connect(&url)
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

/// Like `tools_call`, but only a *business* refusal counts: the tool must
/// exist and answer with an `isError` result. A JSON-RPC error (unknown tool,
/// bad params) is not a refusal — it is the tool being absent.
async fn tools_call_refused(router: &Router, token: &str, name: &str, arguments: Value) -> bool {
    let (_, body) = rpc(
        router,
        Some(token),
        json!({ "jsonrpc": "2.0", "id": 98, "method": "tools/call",
                "params": { "name": name, "arguments": arguments } }),
    )
    .await;
    body.get("error").is_none() && body["result"]["isError"] == true
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
    assert_eq!(tools.len(), 31);
    let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    for n in [
        "list_statuses", "get_workload", "list_time_entries", "list_saved_views",
        "list_task_templates", "create_task_from_template", "bulk_update_tasks",
        "bulk_delete_tasks", "list_automations", "list_automation_runs",
        "create_automation", "update_automation", "delete_automation", "set_automation_mode",
    ] {
        assert!(names.contains(&n), "5a tool `{n}` is advertised");
    }
    let mut unique = names.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), names.len(), "no tool name is listed twice");
    assert!(names.contains(&"create_task"));
    assert!(names.contains(&"log_time"));
    assert!(names.contains(&"create_project_from_template"));
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
async fn create_task_sets_an_initial_status() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;

    let (_, created) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 36, "method": "tools/call",
                "params": { "name": "create_task",
                            "arguments": {
                                "module_id": module_id,
                                "title": "already started",
                                "status": "in_progress"
                            } } }),
    )
    .await;
    assert_eq!(created["result"]["isError"], false, "{created:?}");
    let payload: Value =
        serde_json::from_str(created["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(payload["status"], "in_progress");
}

#[tokio::test]
async fn create_task_rejects_a_misspelled_status() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;

    let (_, body) = rpc(
        &router,
        Some(&token),
        json!({ "jsonrpc": "2.0", "id": 37, "method": "tools/call",
                "params": { "name": "create_task",
                            "arguments": {
                                "module_id": module_id,
                                "title": "typo'd status",
                                "status": "in-progress"
                            } } }),
    )
    .await;
    // `create_task_core` would otherwise default the unknown status to Todo.
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
async fn create_module_appends_to_the_project_and_shows_in_list_modules() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let owner = seed_active_user(&store).await;
    let (project_id, _backlog) = seed_project_and_module(&store, &owner).await;
    let token = issue_token(&store, &owner).await;

    let (is_error, created) = tools_call(
        &router,
        &token,
        "create_module",
        json!({ "project_id": project_id, "name": "  Review  ", "description": "Awaiting QA" }),
    )
    .await;
    assert!(!is_error, "{created:?}");
    assert_eq!(created["name"], "Review", "name is trimmed like the UI path");
    assert_eq!(created["description"], "Awaiting QA");
    // Seeded Backlog is order 0; a new module lands after it.
    assert_eq!(created["order"], 1);
    assert_eq!(created["project_id"], project_id.as_str());
    let new_id = created["id"].as_str().unwrap();

    let (_, listed) =
        tools_call(&router, &token, "list_modules", json!({ "project_id": project_id })).await;
    assert_eq!(listed["count"], 2, "{listed:?}");
    assert!(listed["modules"].as_array().unwrap().iter().any(|m| m["id"] == new_id));
}

#[tokio::test]
async fn create_module_refuses_a_blank_name() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let owner = seed_active_user(&store).await;
    let (project_id, _) = seed_project_and_module(&store, &owner).await;
    let token = issue_token(&store, &owner).await;

    assert!(
        tools_call_refused(
            &router,
            &token,
            "create_module",
            json!({ "project_id": project_id, "name": "   " }),
        )
        .await
    );
}

#[tokio::test]
async fn update_module_renames_and_clears_description() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let owner = seed_active_user(&store).await;
    let (project_id, _) = seed_project_and_module(&store, &owner).await;
    let token = issue_token(&store, &owner).await;
    let (_, created) = tools_call(
        &router,
        &token,
        "create_module",
        json!({ "project_id": project_id, "name": "Old", "description": "to be removed" }),
    )
    .await;
    let module_id = created["id"].as_str().unwrap().to_string();

    // Rename only: description must survive an update that doesn't mention it.
    let (is_error, renamed) = tools_call(
        &router,
        &token,
        "update_module",
        json!({ "module_id": module_id, "name": "New" }),
    )
    .await;
    assert!(!is_error, "{renamed:?}");
    assert_eq!(renamed["name"], "New");
    assert_eq!(renamed["description"], "to be removed");
    assert_eq!(renamed["project_id"], project_id.as_str());

    // An explicit empty description clears it (same semantics as the UI).
    let (is_error, cleared) = tools_call(
        &router,
        &token,
        "update_module",
        json!({ "module_id": module_id, "description": "" }),
    )
    .await;
    assert!(!is_error, "{cleared:?}");
    assert_eq!(cleared["name"], "New");
    assert_eq!(cleared["description"], "");
}

#[tokio::test]
async fn delete_module_removes_an_empty_module() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let owner = seed_active_user(&store).await;
    let (project_id, _backlog) = seed_project_and_module(&store, &owner).await;
    let empty_id = seed_module(&store, &project_id, "Empty").await;
    let token = issue_token(&store, &owner).await;

    let (is_error, payload) =
        tools_call(&router, &token, "delete_module", json!({ "module_id": empty_id })).await;
    assert!(!is_error, "{payload:?}");
    assert_eq!(payload["ok"], true);

    let (_, listed) =
        tools_call(&router, &token, "list_modules", json!({ "project_id": project_id })).await;
    assert_eq!(listed["count"], 1, "{listed:?}");
    assert!(!listed["modules"].as_array().unwrap().iter().any(|m| m["id"] == empty_id.as_str()));
}

#[tokio::test]
async fn delete_module_refuses_a_module_that_still_has_tasks() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let owner = seed_active_user(&store).await;
    let (project_id, module_id) = seed_project_and_module(&store, &owner).await;
    let token = issue_token(&store, &owner).await;
    let task_id = create_task_via_tool(
        &router,
        &token,
        json!({ "module_id": module_id, "title": "must survive" }),
    )
    .await;

    // The Connect handler cascades — deleting a module deletes its tasks. The
    // MCP spec keeps delete_task out precisely so an agent can't silently drop
    // work, and this tool must not be a bigger version of that hole.
    assert!(
        tools_call_refused(&router, &token, "delete_module", json!({ "module_id": module_id }))
            .await
    );

    let (_, listed) =
        tools_call(&router, &token, "list_modules", json!({ "project_id": project_id })).await;
    assert_eq!(listed["count"], 1, "module still there: {listed:?}");
    let (is_error, task) = tools_call(&router, &token, "get_task", json!({ "task_id": task_id })).await;
    assert!(!is_error, "task still there: {task:?}");
}

#[tokio::test]
async fn module_write_tools_refuse_a_plain_member() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let owner = seed_active_user(&store).await;
    let member = seed_active_user(&store).await;
    let (project_id, module_id) = seed_project_and_module(&store, &owner).await;
    store
        .create((domain::project::ProjectMembership {
            project_id: project_id.clone(),
            user_id: member.clone(),
        },))
        .await
        .unwrap();
    let member_token = issue_token(&store, &member).await;

    // Same owner/admin gate as the UI: a member can read modules but not shape them.
    let (is_error, _) =
        tools_call(&router, &member_token, "list_modules", json!({ "project_id": project_id })).await;
    assert!(!is_error, "member can list");
    for (name, args) in [
        ("create_module", json!({ "project_id": project_id, "name": "Nope" })),
        ("update_module", json!({ "module_id": module_id, "name": "Nope" })),
        ("delete_module", json!({ "module_id": module_id })),
    ] {
        assert!(
            tools_call_refused(&router, &member_token, name, args).await,
            "{name} should refuse a plain member"
        );
    }
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

/// The other half of the one-level rule, which `validate_parent` did not
/// enforce: it checked that the proposed parent was not itself a subtask, but
/// never that the task being moved already had children. So C ← A ← B was
/// reachable — three levels — through the same call that refuses two.
///
/// `update_task`'s `parent_id` is what makes this reachable from a model at
/// all, and both tool descriptions promise "nesting is one level deep", so the
/// guarantee has to actually hold rather than be documented.
#[tokio::test]
async fn update_task_refuses_moving_a_task_that_has_subtasks() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;

    let (err, parent) = tools_call(&router, &token, "create_task",
        json!({ "module_id": module_id, "title": "punya anak" })).await;
    assert!(!err, "{parent:?}");
    let (err, child) = tools_call(&router, &token, "create_task",
        json!({ "module_id": module_id, "parent_id": parent["id"], "title": "anak" })).await;
    assert!(!err, "{child:?}");
    let (err, other) = tools_call(&router, &token, "create_task",
        json!({ "module_id": module_id, "title": "induk lain" })).await;
    assert!(!err, "{other:?}");

    let (err, _) = tools_call(&router, &token, "update_task",
        json!({ "task_id": parent["id"], "parent_id": other["id"] })).await;
    assert!(err, "a task with subtasks must not become a subtask");

    // Refused outright, not half-applied: neither end of the chain moved.
    let (err, still) = tools_call(&router, &token, "get_task",
        json!({ "task_id": parent["id"] })).await;
    assert!(!err, "{still:?}");
    assert!(still["parent_id"].is_null(), "{still:?}");
    let (err, kid) = tools_call(&router, &token, "get_task",
        json!({ "task_id": child["id"] })).await;
    assert!(!err, "{kid:?}");
    assert_eq!(kid["parent_id"], parent["id"], "{kid:?}");
}

/// A tool call stamps the token's `last_used_at`, and a second call within the
/// hour leaves the stamp alone.
#[tokio::test]
async fn a_tool_call_records_token_usage_once_per_hour() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let (_, _, token) = seed_user_with_token(&store, domain::user::UserStatus::Active, None).await;
    let hash = domain::token::hash_token(&token);
    let before = transport::api::find_by_hash(&store, &hash).await.unwrap().unwrap();
    assert!(before.last_used_at.is_none());

    let (is_error, _) = tools_call(&router, &token, "list_projects", json!({})).await;
    assert!(!is_error);
    let first = transport::api::find_by_hash(&store, &hash).await.unwrap().unwrap();
    let stamp = first.last_used_at.expect("usage recorded on first call");

    let (is_error, _) = tools_call(&router, &token, "list_projects", json!({})).await;
    assert!(!is_error);
    let second = transport::api::find_by_hash(&store, &hash).await.unwrap().unwrap();
    assert_eq!(second.last_used_at.as_deref(), Some(stamp.as_str()), "throttled within the hour");
}

#[tokio::test]
async fn log_time_records_an_entry_and_validates_input() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;
    let (err, task) = tools_call(&router, &token, "create_task", json!({ "module_id": module_id, "title": "timed" })).await;
    assert!(!err, "create_task: {task}");
    let task_id = task["id"].as_str().unwrap().to_string();

    let (err, e) = tools_call(&router, &token, "log_time",
        json!({ "task_id": task_id, "minutes": 90, "date": "2026-10-02", "note": " pairing " })).await;
    assert!(!err, "log_time: {e}");
    assert_eq!(e["minutes"], 90);
    assert_eq!(e["date"], "2026-10-02");
    assert_eq!(e["note"], "pairing", "the note is trimmed");
    assert_eq!(e["task_id"], task_id.as_str());
    let (_, fetched) = tools_call(&router, &token, "get_task", json!({ "task_id": task_id })).await;
    assert_eq!(fetched["logged_minutes"], 90, "get_task reflects the logged time");

    // Malformed arguments are the caller's bug: a JSON-RPC invalid-params error.
    for args in [
        json!({ "task_id": task_id, "minutes": "90" }),
        json!({ "task_id": task_id, "minutes": 1.5 }),
        json!({ "task_id": task_id }),
        json!({ "minutes": 5 }),
    ] {
        let (_, body) = rpc(&router, Some(&token),
            json!({ "jsonrpc": "2.0", "id": 40, "method": "tools/call",
                    "params": { "name": "log_time", "arguments": args.clone() } })).await;
        assert_eq!(body["error"]["code"], -32602, "malformed {args}: {body:?}");
    }
    // Well-formed but against the rules: a business refusal the model can act on.
    for args in [
        json!({ "task_id": task_id, "minutes": 0 }),
        json!({ "task_id": task_id, "minutes": 1441 }),
        json!({ "task_id": task_id, "minutes": 5, "date": "2026-02-30" }),
        json!({ "task_id": "999999999999", "minutes": 5 }),
    ] {
        assert!(tools_call_refused(&router, &token, "log_time", args.clone()).await, "refused: {args}");
    }

    // Someone outside the project cannot log on its tasks.
    let outsider = seed_active_user(&store).await;
    let outsider_token = issue_token(&store, &outsider).await;
    assert!(
        tools_call_refused(&router, &outsider_token, "log_time", json!({ "task_id": task_id, "minutes": 5 })).await,
        "non-member is refused"
    );
    let (_, fetched) = tools_call(&router, &token, "get_task", json!({ "task_id": task_id })).await;
    assert_eq!(fetched["logged_minutes"], 90, "refused calls logged nothing");
}

#[tokio::test]
async fn list_projects_templates_flag_splits_projects_from_templates() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (project_id, module_id) = seed_project_and_module(&store, &user).await;
    let (err, t) = tools_call(&router, &token, "create_task",
        json!({ "module_id": module_id, "title": "templated", "due_date": "2026-03-05" })).await;
    assert!(!err, "create_task: {t}");

    // list_projects: a project until marked; `templates` flips the listing.
    let ids = |v: &Value| -> Vec<String> {
        v["projects"].as_array().or_else(|| v.as_array()).map(|a| a.iter().filter_map(|p| p["id"].as_str().map(String::from)).collect()).unwrap_or_default()
    };
    let (_, plain) = tools_call(&router, &token, "list_projects", json!({ "limit": 200 })).await;
    assert!(ids(&plain).contains(&project_id), "listed as a project: {plain}");
    // Mark it through the real RPC (the mark has no `persistence::rows` type to seed).
    mark_template(&store, &user, &project_id).await;
    let (_, plain) = tools_call(&router, &token, "list_projects", json!({ "limit": 200 })).await;
    assert!(!ids(&plain).contains(&project_id), "a template leaves the default listing: {plain}");
    let (_, tpls) = tools_call(&router, &token, "list_projects", json!({ "limit": 200, "templates": true })).await;
    assert!(ids(&tpls).contains(&project_id), "templates=true lists it: {tpls}");

}

/// Owner marks `project_id` as a template via `ProjectService/SetProjectTemplate`.
async fn mark_template(store: &Arc<persistence::Store>, owner: &str, project_id: &str) {
    let user = auth::verify_jwt(
        &auth::sign_jwt("mcp-test", owner, &[], 9_999_999_999).unwrap(),
        "mcp-test",
    )
    .unwrap();
    let router = transport::project_router(store.clone()).layer(axum::Extension(user));
    let req = Request::builder()
        .method("POST")
        .uri("/sedjiwa.tasks.project.v1.ProjectService/SetProjectTemplate")
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "id": project_id, "isTemplate": true }).to_string()))
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    let status = resp.status();
    let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    assert_eq!(status, StatusCode::OK, "SetProjectTemplate: {}", String::from_utf8_lossy(&body));
}

#[tokio::test]
async fn create_project_from_template_copies_and_respects_membership() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (project_id, module_id) = seed_project_and_module(&store, &user).await;
    let (err, t) = tools_call(&router, &token, "create_task",
        json!({ "module_id": module_id, "title": "templated", "due_date": "2026-03-05" })).await;
    assert!(!err, "create_task: {t}");
    mark_template(&store, &user, &project_id).await;

    let (_, raw) = rpc(&router, Some(&token),
        json!({ "jsonrpc": "2.0", "id": 49, "method": "tools/call",
                "params": { "name": "create_project_from_template",
                            "arguments": { "source_project_id": project_id, "name": "From MCP", "start_date": "2026-11-02" } } })).await;
    assert_eq!(raw["result"]["isError"], false, "create_project_from_template: {raw}");
    let copy: Value = serde_json::from_str(raw["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(copy["name"], "From MCP");
    assert_eq!(copy["start_date"], "2026-11-02");
    let new_id = copy["id"].as_str().unwrap().to_string();
    assert_ne!(new_id, project_id);
    let (_, tasks) = tools_call(&router, &token, "list_tasks", json!({ "project_id": new_id })).await;
    let list = tasks["tasks"].as_array().or_else(|| tasks.as_array()).cloned().unwrap_or_default();
    assert_eq!(list.len(), 1, "the task came along: {tasks}");
    assert_eq!(list[0]["title"], "templated");
    assert_eq!(list[0]["due_date"], "2026-11-02", "dates shifted to the new start");

    // Malformed vs refused.
    let (_, body) = rpc(&router, Some(&token),
        json!({ "jsonrpc": "2.0", "id": 50, "method": "tools/call",
                "params": { "name": "create_project_from_template", "arguments": { "name": "x" } } })).await;
    assert_eq!(body["error"]["code"], -32602, "a missing source is invalid params: {body:?}");
    let outsider = seed_active_user(&store).await;
    let outsider_token = issue_token(&store, &outsider).await;
    assert!(
        tools_call_refused(&router, &outsider_token, "create_project_from_template",
            json!({ "source_project_id": project_id, "name": "steal" })).await,
        "a non-member cannot copy"
    );
    assert!(
        tools_call_refused(&router, &token, "create_project_from_template",
            json!({ "source_project_id": project_id, "name": "x", "start_date": "2026-13-01" })).await,
        "a bad start_date is refused"
    );
}

#[tokio::test]
async fn create_task_refuses_an_impossible_due_date() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;
    for bad in ["2026-02-30", "2026-13-01", "2026-10-19T08:00:00Z"] {
        assert!(
            tools_call_refused(&router, &token, "create_task",
                json!({ "module_id": module_id, "title": "x", "due_date": bad })).await,
            "due_date {bad} is refused"
        );
    }
    let (err, t) = tools_call(&router, &token, "create_task",
        json!({ "module_id": module_id, "title": "leap", "due_date": "2028-02-29" })).await;
    assert!(!err, "a real leap day is accepted: {t}");
}

#[tokio::test]
async fn my_tasks_leaves_template_projects_out() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (tpl_project, tpl_module) = seed_project_and_module(&store, &user).await;
    let (_real_project, real_module) = seed_project_and_module(&store, &user).await;
    let mut ids = Vec::new();
    for m in [&tpl_module, &real_module] {
        let (err, t) = tools_call(&router, &token, "create_task",
            json!({ "module_id": m, "title": "mine", "assignee_ids": [user], "due_date": "2099-01-01" })).await;
        assert!(!err, "create_task: {t}");
        ids.push(t["id"].as_str().unwrap().to_string());
    }
    mark_template(&store, &user, &tpl_project).await;
    let (err, out) = tools_call(&router, &token, "my_tasks", json!({ "scope": "assigned", "limit": 200 })).await;
    assert!(!err, "my_tasks: {out}");
    let text = out.to_string();
    assert!(text.contains(&ids[1]), "the real project's task is listed: {out}");
    assert!(!text.contains(&ids[0]), "the template's task is not: {out}");
}

#[tokio::test]
async fn log_time_defaults_to_the_workspace_day() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_p, module_id) = seed_project_and_module(&store, &user).await;
    let (_, t) = tools_call(&router, &token, "create_task", json!({ "module_id": module_id, "title": "clock" })).await;
    // The default zone, Asia/Jakarta, is UTC+7 all year.
    let jakarta = |_: ()| (time::OffsetDateTime::now_utc() + time::Duration::hours(7)).date().to_string();
    let before = jakarta(());
    let (err, e) = tools_call(&router, &token, "log_time", json!({ "task_id": t["id"], "minutes": 15 })).await;
    let after = jakarta(());
    assert!(!err, "log_time: {e}");
    let d = e["date"].as_str().unwrap_or_default();
    assert!(d == before || d == after, "log_time without a date uses the workspace day ({before}), got {d}");
}

#[tokio::test]
async fn log_time_through_mcp_lands_in_the_activity_log() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_p, module_id) = seed_project_and_module(&store, &user).await;
    let (_, t) = tools_call(&router, &token, "create_task", json!({ "module_id": module_id, "title": "via mcp" })).await;
    let task_id = t["id"].as_str().unwrap().to_string();
    let (err, e) = tools_call(&router, &token, "log_time", json!({ "task_id": task_id, "minutes": 45 })).await;
    assert!(!err, "log_time: {e}");
    // Read the task's activity through the real ActivityService as the same user.
    let me = auth::verify_jwt(&auth::sign_jwt("mcp-test", &user, &[], 9_999_999_999).unwrap(), "mcp-test").unwrap();
    let activity = transport::activity_router(store.clone()).layer(axum::Extension(me));
    let req = Request::builder()
        .method("POST")
        .uri("/sedjiwa.tasks.activity.v1.ActivityService/ListEntityActivity")
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "entityType": "TASK", "entityId": task_id }).to_string()))
        .unwrap();
    let resp = activity.oneshot(req).await.unwrap();
    let body: Value = serde_json::from_slice(&to_bytes(resp.into_body(), usize::MAX).await.unwrap()).unwrap();
    let rows: Vec<&Value> = body["activities"].as_array().unwrap().iter().filter(|a| a["entityType"] == "TIME_ENTRY").collect();
    assert_eq!(rows.len(), 1, "one row for the MCP log: {body}");
    assert_eq!(rows[0]["action"], "CREATED");
    assert_eq!(rows[0]["actorId"], user.as_str());
    assert_eq!(rows[0]["entityId"], e["id"]);
}

// ---------------------------------------------------------------------------
// 5a: planning reads, templates, bulk edits and automations through MCP.
// ---------------------------------------------------------------------------

/// The JSON-RPC error code of a `tools/call`, or `None` when it answered with
/// a result (business refusals included).
async fn protocol_error(router: &Router, token: &str, name: &str, arguments: Value) -> Option<i64> {
    let (_, body) = rpc(
        router,
        Some(token),
        json!({ "jsonrpc": "2.0", "id": 77, "method": "tools/call",
                "params": { "name": name, "arguments": arguments } }),
    )
    .await;
    body["error"]["code"].as_i64()
}

/// Call a Connect RPC as `user`, for seeding things the MCP tools under test
/// only read (templates, views, estimates).
async fn connect_as(store: &Arc<persistence::Store>, user: &str, path: &str, body: Value) -> Value {
    let me = auth::verify_jwt(&auth::sign_jwt("mcp-test", user, &[], 9_999_999_999).unwrap(), "mcp-test").unwrap();
    let app = Router::new()
        .merge(transport::template_router(store.clone()))
        .merge(transport::view_router(store.clone()))
        .merge(transport::task_router(store.clone()))
        .layer(axum::Extension(me));
    let req = Request::builder()
        .method("POST")
        .uri(path)
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    let st = resp.status();
    let v: Value = serde_json::from_slice(&to_bytes(resp.into_body(), usize::MAX).await.unwrap()).unwrap_or(Value::Null);
    assert_eq!(st, StatusCode::OK, "{path}: {v}");
    v
}

async fn add_member(store: &persistence::Store, project_id: &str, user: &str) {
    store
        .create((domain::project::ProjectMembership { project_id: project_id.to_string(), user_id: user.to_string() },))
        .await
        .unwrap();
}

async fn new_task(router: &Router, token: &str, args: Value) -> String {
    let (err, t) = tools_call(router, token, "create_task", args.clone()).await;
    assert!(!err, "create_task {args}: {t}");
    t["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn list_statuses_returns_board_order_with_categories_and_is_member_gated() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (project_id, _m) = seed_project_and_module(&store, &user).await;

    let (err, v) = tools_call(&router, &token, "list_statuses", json!({ "project_id": project_id })).await;
    assert!(!err, "list_statuses: {v}");
    let rows = v["statuses"].as_array().unwrap();
    assert!(rows.len() >= 4, "a new project has its default statuses: {v}");
    let cats: Vec<&str> = rows.iter().map(|r| r["category"].as_str().unwrap()).collect();
    for c in ["todo", "in_progress", "done", "cancelled"] {
        assert!(cats.contains(&c), "category `{c}` is spelled the way task tools accept it: {cats:?}");
    }
    assert_eq!(cats[0], "todo", "board order starts with the todo column");
    for r in rows {
        assert!(r["id"].as_str().is_some_and(|s| !s.is_empty()) && r["name"].as_str().is_some_and(|s| !s.is_empty()), "{r}");
    }

    let outsider = issue_token(&store, &seed_active_user(&store).await).await;
    assert!(tools_call_refused(&router, &outsider, "list_statuses", json!({ "project_id": project_id })).await, "non-member refused");
    assert!(tools_call_refused(&router, &token, "list_statuses", json!({ "project_id": "999999999999" })).await, "unknown project refused");
    assert_eq!(protocol_error(&router, &token, "list_statuses", json!({})).await, Some(-32602), "project_id is required");
}

#[tokio::test]
async fn list_saved_views_shows_mine_and_shared_but_not_others_personal_views() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (project_id, _m) = seed_project_and_module(&store, &user).await;
    let other = seed_active_user(&store).await;
    add_member(&store, &project_id, &other).await;

    const V: &str = "/sedjiwa.tasks.view.v1.SavedViewService/CreateSavedView";
    let mine = connect_as(&store, &user, V, json!({ "projectId": project_id, "name": "Mine", "query": "status=todo", "layout": "BOARD" })).await;
    let shared = connect_as(&store, &other, V, json!({ "projectId": project_id, "name": "Team", "query": "priority=high", "shared": true })).await;
    let hidden = connect_as(&store, &other, V, json!({ "projectId": project_id, "name": "Private", "query": "x=1" })).await;

    let (err, v) = tools_call(&router, &token, "list_saved_views", json!({ "project_id": project_id })).await;
    assert!(!err, "list_saved_views: {v}");
    let views = v["views"].as_array().unwrap();
    let by_id = |id: &Value| views.iter().find(|x| x["id"] == *id).cloned();
    let m = by_id(&mine["id"]).expect("my own view is listed");
    assert_eq!(m["layout"], "board");
    assert_eq!(m["query"], "status=todo", "the filter query travels verbatim");
    assert_eq!(m["shared"], false);
    assert_eq!(m["owner_id"], user.as_str());
    let s = by_id(&shared["id"]).expect("a shared view is listed");
    assert_eq!(s["layout"], "list", "unspecified layout reads as list");
    assert_eq!(s["shared"], true);
    assert!(by_id(&hidden["id"]).is_none(), "another member's personal view does not leak");

    let outsider = issue_token(&store, &seed_active_user(&store).await).await;
    assert!(tools_call_refused(&router, &outsider, "list_saved_views", json!({ "project_id": project_id })).await, "non-member refused");
    assert_eq!(protocol_error(&router, &token, "list_saved_views", json!({})).await, Some(-32602));
}

#[tokio::test]
async fn list_time_entries_filters_sums_caps_and_does_not_leak() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (project_id, module_id) = seed_project_and_module(&store, &user).await;
    let a = new_task(&router, &token, json!({ "module_id": module_id, "title": "A" })).await;
    let b = new_task(&router, &token, json!({ "module_id": module_id, "title": "B" })).await;
    for (t, m, d) in [(&a, 30, "2026-10-01"), (&a, 45, "2026-10-03"), (&b, 60, "2026-10-05")] {
        let (err, e) = tools_call(&router, &token, "log_time", json!({ "task_id": t, "minutes": m, "date": d })).await;
        assert!(!err, "log_time: {e}");
    }

    let (err, v) = tools_call(&router, &token, "list_time_entries", json!({ "project_id": project_id })).await;
    assert!(!err, "{v}");
    assert_eq!(v["count"], 3);
    assert_eq!(v["total_minutes"], 135);
    assert_eq!(v["truncated"], false);
    let dates: Vec<&str> = v["entries"].as_array().unwrap().iter().map(|e| e["date"].as_str().unwrap()).collect();
    assert_eq!(dates, ["2026-10-05", "2026-10-03", "2026-10-01"], "newest first");
    let first = &v["entries"][0];
    assert_eq!(first["task_id"], b.as_str());
    assert_eq!(first["task_title"], "B");
    assert_eq!(first["project_id"], project_id.as_str());
    assert_eq!(first["user_id"], user.as_str());

    let (_, v) = tools_call(&router, &token, "list_time_entries", json!({ "task_id": a })).await;
    assert_eq!((v["count"].as_i64(), v["total_minutes"].as_i64()), (Some(2), Some(75)), "by task: {v}");
    let (_, v) = tools_call(&router, &token, "list_time_entries",
        json!({ "project_id": project_id, "from": "2026-10-02", "to": "2026-10-05" })).await;
    assert_eq!(v["total_minutes"], 105, "from/to are inclusive: {v}");
    let (_, v) = tools_call(&router, &token, "list_time_entries", json!({ "user_id": user })).await;
    assert_eq!(v["count"], 3, "by person across my projects: {v}");
    let (_, v) = tools_call(&router, &token, "list_time_entries", json!({ "project_id": project_id, "limit": 1 })).await;
    assert_eq!(v["count"], 1);
    assert_eq!(v["truncated"], true, "a cut list says so");
    assert_eq!(v["total_minutes"], 60, "the sum covers the entries returned, as described");

    // Malformed → protocol error; well-formed but wrong → business refusal.
    for args in [json!({}), json!({ "project_id": project_id, "limit": 0 }), json!({ "project_id": project_id, "limit": 201 })] {
        assert_eq!(protocol_error(&router, &token, "list_time_entries", args.clone()).await, Some(-32602), "{args}");
    }
    assert!(tools_call_refused(&router, &token, "list_time_entries", json!({ "project_id": project_id, "from": "2026-13-01" })).await, "bad date refused");

    // An outsider sees nothing of the project, neither by id nor through the person.
    let outsider = issue_token(&store, &seed_active_user(&store).await).await;
    assert!(tools_call_refused(&router, &outsider, "list_time_entries", json!({ "project_id": project_id })).await, "non-member, by project");
    assert!(tools_call_refused(&router, &outsider, "list_time_entries", json!({ "task_id": a })).await, "non-member, by task");
    let (err, v) = tools_call(&router, &outsider, "list_time_entries", json!({ "user_id": user })).await;
    assert!(!err, "{v}");
    assert_eq!(v["count"], 0, "by person, an outsider gets none of that person's entries in projects they cannot see: {v}");
}

#[tokio::test]
async fn get_workload_reports_weeks_and_one_persons_tasks() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (project_id, module_id) = seed_project_and_module(&store, &user).await;
    let t = new_task(&router, &token, json!({ "module_id": module_id, "title": "estimated", "assignee_ids": [user] })).await;
    connect_as(&store, &user, "/sedjiwa.tasks.work.v1.TaskService/UpdateTask",
        json!({ "id": t, "estimateMinutes": 240 })).await;

    let (err, v) = tools_call(&router, &token, "get_workload", json!({ "project_id": project_id, "weeks": 3 })).await;
    assert!(!err, "get_workload: {v}");
    assert_eq!(v["week_starts"].as_array().unwrap().len(), 3, "weeks is honoured");
    assert_eq!(v["projects"][0]["id"], project_id.as_str());
    let me = v["members"].as_array().unwrap().iter().find(|m| m["user_id"] == user.as_str()).cloned().expect("I am in my project's workload");
    assert_eq!(me["weeks"].as_array().unwrap().len(), 3);
    assert_eq!(me["unscheduled_minutes"], 240, "an undated estimated task is unscheduled load: {me}");
    assert!(me.get("tasks").is_none(), "task lists only come with user_id");

    let (err, v) = tools_call(&router, &token, "get_workload", json!({ "project_id": project_id, "user_id": user })).await;
    assert!(!err, "{v}");
    assert_eq!(v["members"].as_array().unwrap().len(), 1, "user_id narrows to one person");
    assert_eq!(v["week_starts"].as_array().unwrap().len(), 6, "default is 6 weeks");
    let tasks = v["members"][0]["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 1, "{v}");
    assert_eq!(tasks[0]["task_id"], t.as_str());
    assert_eq!(tasks[0]["bucket"], "unscheduled");
    assert_eq!(tasks[0]["remaining_minutes"], 240);

    assert!(tools_call_refused(&router, &token, "get_workload", json!({ "project_id": project_id, "user_id": "999999999999" })).await,
        "a person with no workload here is a readable refusal, not an empty success");
    for w in [json!(0), json!(13), json!("3"), json!(2.5)] {
        assert_eq!(protocol_error(&router, &token, "get_workload", json!({ "weeks": w })).await, Some(-32602), "weeks {w}");
    }
    let outsider = issue_token(&store, &seed_active_user(&store).await).await;
    assert!(tools_call_refused(&router, &outsider, "get_workload", json!({ "project_id": project_id })).await, "non-member refused");
    let (err, v) = tools_call(&router, &outsider, "get_workload", json!({})).await;
    assert!(!err, "{v}");
    assert!(v["projects"].as_array().unwrap().iter().all(|p| p["id"] != project_id.as_str()), "the all-projects view leaves out projects I am not in");
}

#[tokio::test]
async fn task_templates_list_and_create_with_subtasks() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (project_id, module_id) = seed_project_and_module(&store, &user).await;
    let other_module = seed_module(&store, &project_id, "Sprint").await;
    let src = new_task(&router, &token, json!({ "module_id": module_id, "title": "Release", "priority": "high" })).await;
    new_task(&router, &token, json!({ "module_id": module_id, "title": "Tag", "parent_id": src })).await;
    new_task(&router, &token, json!({ "module_id": module_id, "title": "Notes", "parent_id": src })).await;
    let tpl = connect_as(&store, &user, "/sedjiwa.tasks.templates.v1.TemplateService/SaveTaskTemplate",
        json!({ "taskId": src, "name": "Release checklist" })).await;
    let tpl_id = tpl["id"].as_str().unwrap().to_string();

    let (err, v) = tools_call(&router, &token, "list_task_templates", json!({ "project_id": project_id })).await;
    assert!(!err, "{v}");
    let t = v["templates"].as_array().unwrap().iter().find(|t| t["id"] == tpl_id.as_str()).cloned().expect("listed");
    assert_eq!(t["name"], "Release checklist");
    assert_eq!(t["title"], "Release");
    assert_eq!(t["priority"], "high");
    let mut subs: Vec<&str> = t["subtasks"].as_array().unwrap().iter().map(|s| s.as_str().unwrap()).collect();
    subs.sort();
    assert_eq!(subs, ["Notes", "Tag"]);

    let (err, made) = tools_call(&router, &token, "create_task_from_template", json!({
        "template_id": tpl_id, "module_id": other_module, "title": "Release 2.0",
        "assignee_ids": [user], "due_date": "2026-11-30" })).await;
    assert!(!err, "create_task_from_template: {made}");
    assert_eq!(made["title"], "Release 2.0", "title override");
    assert_eq!(made["module_id"], other_module.as_str());
    assert_eq!(made["priority"], "high", "priority from the template");
    assert_eq!(made["due_date"], "2026-11-30");
    assert_eq!(made["assignee_ids"], json!([user]));
    let new_id = made["id"].as_str().unwrap().to_string();
    let (_, listed) = tools_call(&router, &token, "list_tasks", json!({ "module_id": other_module })).await;
    let kids: Vec<&Value> = listed["tasks"].as_array().unwrap().iter().filter(|x| x["parent_id"] == new_id.as_str()).collect();
    assert_eq!(kids.len(), 2, "the template's subtasks came along: {listed}");

    let (err, plain) = tools_call(&router, &token, "create_task_from_template", json!({ "template_id": tpl_id, "module_id": module_id })).await;
    assert!(!err, "{plain}");
    assert_eq!(plain["title"], "Release", "title defaults to the template's");

    // A module in another project, an outsider, a bad date: refused, nothing made.
    let (_p2, foreign_module) = seed_project_and_module(&store, &user).await;
    assert!(tools_call_refused(&router, &token, "create_task_from_template", json!({ "template_id": tpl_id, "module_id": foreign_module })).await, "module of another project");
    assert!(tools_call_refused(&router, &token, "create_task_from_template", json!({ "template_id": tpl_id, "module_id": module_id, "due_date": "2026-02-30" })).await, "impossible date");
    assert!(tools_call_refused(&router, &token, "create_task_from_template", json!({ "template_id": "999999999999", "module_id": module_id })).await, "unknown template");
    let outsider = issue_token(&store, &seed_active_user(&store).await).await;
    assert!(tools_call_refused(&router, &outsider, "list_task_templates", json!({ "project_id": project_id })).await, "non-member cannot list");
    assert!(tools_call_refused(&router, &outsider, "create_task_from_template", json!({ "template_id": tpl_id, "module_id": module_id })).await, "non-member cannot use");
    let (_, after) = tools_call(&router, &token, "list_tasks", json!({ "project_id": project_id, "limit": 200 })).await;
    let roots = after["tasks"].as_array().unwrap().iter().filter(|x| x["title"].as_str().is_some_and(|t| t.starts_with("Release")) && x["parent_id"].as_str().unwrap_or("").is_empty()).count();
    assert_eq!(roots, 3, "only the source and the two successful creations exist: {after}");
    for args in [json!({ "module_id": module_id }), json!({ "template_id": tpl_id })] {
        assert_eq!(protocol_error(&router, &token, "create_task_from_template", args.clone()).await, Some(-32602), "{args}");
    }
}

#[tokio::test]
async fn bulk_update_tasks_applies_each_field_and_refuses_bad_calls() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (project_id, module_id) = seed_project_and_module(&store, &user).await;
    let sprint = seed_module(&store, &project_id, "Sprint").await;
    let mate = seed_active_user(&store).await;
    add_member(&store, &project_id, &mate).await;
    let ids: Vec<String> = three_tasks(&router, &token, &module_id, &user).await;

    let (err, v) = tools_call(&router, &token, "bulk_update_tasks", json!({
        "task_ids": ids, "status": "in_progress", "priority": "urgent",
        "add_assignee_ids": [mate], "remove_assignee_ids": [user], "due_date": "2026-12-01" })).await;
    assert!(!err, "bulk_update_tasks: {v}");
    assert_eq!(v["updated_count"], 3);
    assert_eq!(v["failed"], json!([]));
    for id in &ids {
        let (_, t) = tools_call(&router, &token, "get_task", json!({ "task_id": id })).await;
        assert_eq!(t["status"], "in_progress", "category → its first status: {t}");
        assert_eq!(t["priority"], "urgent");
        assert_eq!(t["assignee_ids"], json!([mate]), "added one, removed the other");
        assert_eq!(t["due_date"], "2026-12-01");
    }

    // A status by name, a module move, and null clears the due date.
    let (_, st) = tools_call(&router, &token, "list_statuses", json!({ "project_id": project_id })).await;
    let done = st["statuses"].as_array().unwrap().iter().find(|s| s["category"] == "done").unwrap()["name"].as_str().unwrap().to_string();
    let (err, v) = tools_call(&router, &token, "bulk_update_tasks", json!({
        "task_ids": [ids[0]], "status": done.to_lowercase(), "due_date": null, "module_id": sprint })).await;
    assert!(!err, "{v}");
    let (_, t) = tools_call(&router, &token, "get_task", json!({ "task_id": ids[0] })).await;
    assert_eq!(t["status"], "done", "status by name, case-insensitively: {t}");
    assert!(t["due_date"].as_str().unwrap_or("").is_empty(), "null cleared the due date: {t}");
    assert_eq!(t["module_id"], sprint.as_str());
    assert_eq!(t["priority"], "urgent", "fields not sent are left as-is");

    // Malformed → protocol errors.
    for args in [
        json!({ "task_ids": [] }),
        json!({ "task_ids": "x", "priority": "low" }),
        json!({ "task_ids": [ids[0]] }),
        json!({ "task_ids": [ids[0]], "due_date": "" }),
        json!({ "task_ids": [ids[0]], "due_date": 5 }),
        json!({ "task_ids": [ids[0]], "priority": "hgih" }),
        json!({ "task_ids": [ids[0], 7], "priority": "low" }),
        json!({ "task_ids": [ids[1]], "status": "Nope" }),
    ] {
        assert_eq!(protocol_error(&router, &token, "bulk_update_tasks", args.clone()).await, Some(-32602), "{args}");
    }
    // Well-formed but against the rules → business refusals, nothing changed.
    let (_p2, m2) = seed_project_and_module(&store, &user).await;
    let foreign = new_task(&router, &token, json!({ "module_id": m2, "title": "elsewhere" })).await;
    let outsider = issue_token(&store, &seed_active_user(&store).await).await;
    for (tok, args, why) in [
        (&token, json!({ "task_ids": [ids[1], foreign], "priority": "low" }), "tasks of two projects"),
        (&token, json!({ "task_ids": [ids[1]], "module_id": m2 }), "module of another project"),
        (&token, json!({ "task_ids": [ids[1]], "due_date": "2026-02-30" }), "impossible date"),
        (&token, json!({ "task_ids": ["999999999999"], "priority": "low" }), "unknown id"),
        (&outsider, json!({ "task_ids": [ids[1]], "priority": "low" }), "non-member"),
        (&outsider, json!({ "task_ids": [ids[1]], "status": "done" }), "non-member, status path"),
    ] {
        assert!(tools_call_refused(&router, tok, "bulk_update_tasks", args.clone()).await, "{why}: {args}");
    }
    let (_, t) = tools_call(&router, &token, "get_task", json!({ "task_id": ids[1] })).await;
    assert_eq!((t["priority"].as_str(), t["module_id"].as_str(), t["status"].as_str()),
        (Some("urgent"), Some(module_id.as_str()), Some("in_progress")), "refused calls changed nothing: {t}");
}

/// Three tasks in `module_id`, each assigned to `user`.
async fn three_tasks(router: &Router, token: &str, module_id: &str, user: &str) -> Vec<String> {
    let mut out = Vec::new();
    for n in 1..=3 {
        out.push(new_task(router, token, json!({ "module_id": module_id, "title": format!("bulk {n}"), "assignee_ids": [user] })).await);
    }
    out
}

#[tokio::test]
async fn bulk_delete_tasks_previews_then_deletes_only_on_the_matching_count() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let user = seed_active_user(&store).await;
    let token = issue_token(&store, &user).await;
    let (_project_id, module_id) = seed_project_and_module(&store, &user).await;
    let parent = new_task(&router, &token, json!({ "module_id": module_id, "title": "parent" })).await;
    let sub1 = new_task(&router, &token, json!({ "module_id": module_id, "title": "sub 1", "parent_id": parent })).await;
    let sub2 = new_task(&router, &token, json!({ "module_id": module_id, "title": "sub 2", "parent_id": parent })).await;
    let lone = new_task(&router, &token, json!({ "module_id": module_id, "title": "lone" })).await;
    let keep = new_task(&router, &token, json!({ "module_id": module_id, "title": "keep" })).await;
    for (t, m) in [(&parent, 30), (&sub1, 20), (&lone, 10), (&keep, 99)] {
        assert!(!tools_call(&router, &token, "log_time", json!({ "task_id": t, "minutes": m })).await.0);
    }
    let exists = |id: String| {
        let router = router.clone();
        let token = token.clone();
        async move { !tools_call(&router, &token, "get_task", json!({ "task_id": id })).await.0 }
    };

    // Preview: selected parent (+2 subtasks not selected) and lone; sub1 picked
    // too must not be counted twice, nor a duplicated id.
    let sel = json!([parent, lone, sub1, lone]);
    let (err, p) = tools_call(&router, &token, "bulk_delete_tasks", json!({ "task_ids": sel })).await;
    assert!(!err, "preview: {p}");
    assert_eq!(p["deleted"], false);
    assert_eq!(p["preview"]["selected"], 3, "duplicates are not counted twice: {p}");
    assert_eq!(p["preview"]["subtasks"], 1, "only the unselected subtask is extra: {p}");
    assert_eq!(p["preview"]["total"], 4);
    assert_eq!(p["preview"]["logged_minutes"], 60, "time on every task that goes, subtasks included: {p}");
    assert!(p["next"].as_str().unwrap().contains("confirm_count = 4"), "{p}");
    assert!(p["preview"]["tasks"].as_array().unwrap().iter().any(|t| t["title"] == "parent"));
    for id in [&parent, &sub1, &sub2, &lone] {
        assert!(exists(id.clone()).await, "a preview deletes nothing");
    }

    // A count that does not match deletes nothing.
    for c in [3, 5] {
        assert!(tools_call_refused(&router, &token, "bulk_delete_tasks", json!({ "task_ids": sel, "confirm_count": c })).await, "count {c}");
    }
    for c in [json!(0), json!(-1), json!("4"), json!(4.5)] {
        assert_eq!(protocol_error(&router, &token, "bulk_delete_tasks", json!({ "task_ids": sel, "confirm_count": c })).await, Some(-32602), "confirm_count {c}");
    }
    assert_eq!(protocol_error(&router, &token, "bulk_delete_tasks", json!({ "task_ids": [] })).await, Some(-32602));
    // Outsiders get neither a preview (titles) nor a delete.
    let outsider = issue_token(&store, &seed_active_user(&store).await).await;
    let (err, leak) = tools_call(&router, &outsider, "bulk_delete_tasks", json!({ "task_ids": sel })).await;
    assert!(err, "non-member preview refused");
    assert!(!leak.to_string().contains("parent"), "no titles leak to a non-member: {leak}");
    assert!(tools_call_refused(&router, &outsider, "bulk_delete_tasks", json!({ "task_ids": sel, "confirm_count": 4 })).await);
    for id in [&parent, &sub1, &sub2, &lone] {
        assert!(exists(id.clone()).await, "refusals deleted nothing");
    }

    let (err, d) = tools_call(&router, &token, "bulk_delete_tasks", json!({ "task_ids": sel, "confirm_count": 4 })).await;
    assert!(!err, "confirmed delete: {d}");
    assert_eq!(d["deleted"], true);
    assert_eq!(d["failed"], json!([]));
    for id in [&parent, &sub1, &sub2, &lone] {
        assert!(!exists(id.clone()).await, "task {id} is gone, subtasks included");
    }
    assert!(exists(keep.clone()).await, "an unselected task is untouched");
    let (_, v) = tools_call(&router, &token, "list_time_entries", json!({ "user_id": user })).await;
    assert_eq!(v["total_minutes"], 99, "the deleted tasks' time went with them: {v}");
}

#[tokio::test]
async fn automations_round_trip_with_status_names_and_owner_only_writes() {
    let Some((router, store)) = router_and_store().await else { return skipped() };
    let owner = seed_active_user(&store).await;
    let token = issue_token(&store, &owner).await;
    let (project_id, module_id) = seed_project_and_module(&store, &owner).await;
    let member = seed_active_user(&store).await;
    add_member(&store, &project_id, &member).await;
    let mtoken = issue_token(&store, &member).await;
    let outsider = issue_token(&store, &seed_active_user(&store).await).await;
    let (_, st) = tools_call(&router, &token, "list_statuses", json!({ "project_id": project_id })).await;
    let first_of = |c: &str| st["statuses"].as_array().unwrap().iter().find(|s| s["category"] == c).unwrap().clone();
    let (done, doing) = (first_of("done"), first_of("in_progress"));

    let rule = json!({
        "project_id": project_id, "name": "Close out",
        "trigger": { "kind": "status_changed", "to": done["name"] },
        "actions": [{ "kind": "set_status", "status": "in_progress" }, { "kind": "set_priority", "priority": "low" }]
    });
    assert!(tools_call_refused(&router, &mtoken, "create_automation", rule.clone()).await, "a plain member cannot create");
    assert!(tools_call_refused(&router, &outsider, "create_automation", rule.clone()).await, "a non-member cannot create");
    let (err, a) = tools_call(&router, &token, "create_automation", rule.clone()).await;
    assert!(!err, "create_automation: {a}");
    assert_eq!(a["mode"], "observe", "new rules start in observe");
    assert_eq!(a["trigger"]["to"], done["id"], "a status name is stored as its id");
    assert_eq!(a["trigger"]["to_name"], done["name"], "and the reply carries the name");
    assert_eq!(a["actions"][0]["status_id"], doing["id"], "an action may name a category");
    assert_eq!(a["actions"][0]["status_name"], doing["name"]);
    assert_eq!(a["updated_by"], owner.as_str());
    let id = a["id"].as_str().unwrap().to_string();

    let (err, l) = tools_call(&router, &mtoken, "list_automations", json!({ "project_id": project_id })).await;
    assert!(!err, "a member can read the rules: {l}");
    assert_eq!(l["automations"].as_array().unwrap().iter().filter(|x| x["id"] == id.as_str()).count(), 1);
    assert!(tools_call_refused(&router, &outsider, "list_automations", json!({ "project_id": project_id })).await, "non-member cannot read");
    assert!(tools_call_refused(&router, &outsider, "list_automation_runs", json!({ "project_id": project_id })).await, "non-member cannot read runs");

    // Bad rules are the caller's bug, with the help text to fix them.
    for (args, why) in [
        (json!({ "project_id": project_id, "name": "x", "trigger": { "kind": "nope" }, "actions": [{ "kind": "unassign_all" }] }), "unknown trigger"),
        (json!({ "project_id": project_id, "name": "x", "trigger": { "kind": "task_created" }, "actions": { "kind": "unassign_all" } }), "actions not a list"),
        (json!({ "project_id": project_id, "name": "x", "trigger": { "kind": "task_created" }, "actions": [{ "kind": "set_status", "status": "Nope" }] }), "unknown status"),
        (json!({ "project_id": project_id, "name": "x", "trigger": { "kind": "status_changed", "to": "done" }, "actions": [{ "kind": "unassign_all" }] }), "trigger takes an exact status, not a category"),
        (json!({ "project_id": project_id, "name": "x", "trigger": { "kind": "task_created" }, "actions": [{ "kind": "unassign_all" }], "mode": "maybe" }), "bad mode"),
        (json!({ "project_id": project_id, "trigger": { "kind": "task_created" }, "actions": [{ "kind": "unassign_all" }] }), "name required"),
    ] {
        if done["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case("done")) && why.starts_with("trigger takes") {
            continue; // the default status really is called "Done", so the name matches
        }
        assert_eq!(protocol_error(&router, &token, "create_automation", args.clone()).await, Some(-32602), "{why}: {args}");
    }
    for (args, why) in [
        (json!({ "project_id": project_id, "name": "   ", "trigger": { "kind": "task_created" }, "actions": [{ "kind": "unassign_all" }] }), "blank name"),
        (json!({ "project_id": project_id, "name": "x", "trigger": { "kind": "task_created" }, "actions": [] }), "no actions"),
        (json!({ "project_id": project_id, "name": "x", "trigger": { "kind": "due_in", "days": 99 }, "actions": [{ "kind": "unassign_all" }] }), "due_in out of range"),
    ] {
        let refused = tools_call_refused(&router, &token, "create_automation", args.clone()).await
            || protocol_error(&router, &token, "create_automation", args.clone()).await.is_some();
        assert!(refused, "{why} is refused: {args}");
    }

    // Update: only what is sent changes; mode is untouched.
    let (err, u) = tools_call(&router, &token, "update_automation", json!({ "id": id, "name": "Close out v2" })).await;
    assert!(!err, "{u}");
    assert_eq!(u["name"], "Close out v2");
    assert_eq!(u["trigger"], a["trigger"], "trigger kept");
    assert_eq!(u["actions"], a["actions"], "actions kept");
    assert_eq!(u["mode"], "observe", "update does not touch the mode");
    let (err, u) = tools_call(&router, &token, "update_automation", json!({ "id": id, "actions": [{ "kind": "set_priority", "priority": "high" }] })).await;
    assert!(!err, "{u}");
    assert_eq!(u["actions"].as_array().unwrap().len(), 1, "a sent list replaces the whole list");
    assert_eq!(u["name"], "Close out v2");
    assert_eq!(protocol_error(&router, &token, "update_automation", json!({ "id": id })).await, Some(-32602), "nothing to change");
    assert!(tools_call_refused(&router, &mtoken, "update_automation", json!({ "id": id, "name": "hijack" })).await, "member cannot update");
    assert!(tools_call_refused(&router, &token, "update_automation", json!({ "id": "999999999999", "name": "x" })).await, "unknown id");

    // Mode.
    assert!(tools_call_refused(&router, &mtoken, "set_automation_mode", json!({ "id": id, "mode": "on" })).await, "member cannot switch it on");
    assert_eq!(protocol_error(&router, &token, "set_automation_mode", json!({ "id": id, "mode": "maybe" })).await, Some(-32602));
    assert_eq!(protocol_error(&router, &token, "set_automation_mode", json!({ "id": id })).await, Some(-32602));
    let (err, m) = tools_call(&router, &token, "set_automation_mode", json!({ "id": id, "mode": "off" })).await;
    assert!(!err, "{m}");
    assert_eq!(m["mode"], "off");
    let (_, l) = tools_call(&router, &token, "list_automations", json!({ "project_id": project_id })).await;
    let row = l["automations"].as_array().unwrap().iter().find(|x| x["id"] == id.as_str()).cloned().unwrap();
    assert_eq!((row["mode"].as_str(), row["name"].as_str()), (Some("off"), Some("Close out v2")), "a follow-up read agrees");

    // An `on` rule fires on a task created through MCP, and its run is listed.
    let (err, live) = tools_call(&router, &token, "create_automation", json!({
        "project_id": project_id, "name": "Urgent intake", "mode": "on",
        "trigger": { "kind": "task_created" }, "actions": [{ "kind": "set_priority", "priority": "urgent" }] })).await;
    assert!(!err, "{live}");
    assert_eq!(live["mode"], "on");
    let live_id = live["id"].as_str().unwrap().to_string();
    let t = new_task(&router, &mtoken, json!({ "module_id": module_id, "title": "incoming" })).await;
    let (_, task) = tools_call(&router, &token, "get_task", json!({ "task_id": t })).await;
    assert_eq!(task["priority"], "urgent", "the rule ran on an MCP-created task: {task}");
    let (err, r) = tools_call(&router, &mtoken, "list_automation_runs", json!({ "project_id": project_id, "automation_id": live_id })).await;
    assert!(!err, "{r}");
    let runs = r["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 1, "{r}");
    assert_eq!(runs[0]["task_id"], t.as_str());
    assert_eq!(runs[0]["status"], "ok");
    assert_eq!(runs[0]["trigger"], "task_created");
    assert_eq!(runs[0]["automation_name"], "Urgent intake");
    let (_, r) = tools_call(&router, &token, "list_automation_runs", json!({ "project_id": project_id, "automation_id": id })).await;
    assert_eq!(r["runs"], json!([]), "automation_id filters to one rule");
    for l in [json!(0), json!(201), json!("5")] {
        assert_eq!(protocol_error(&router, &token, "list_automation_runs", json!({ "project_id": project_id, "limit": l })).await, Some(-32602), "limit {l}");
    }
    let (_, l) = tools_call(&router, &token, "list_automations", json!({ "project_id": project_id })).await;
    let row = l["automations"].as_array().unwrap().iter().find(|x| x["id"] == live_id.as_str()).cloned().unwrap();
    assert_eq!(row["run_count"], 1, "the run is counted on the rule");

    // Delete: owner only, then gone with its history.
    assert!(tools_call_refused(&router, &mtoken, "delete_automation", json!({ "id": live_id })).await, "member cannot delete");
    let (err, d) = tools_call(&router, &token, "delete_automation", json!({ "id": live_id })).await;
    assert!(!err, "{d}");
    assert_eq!(d, json!({ "deleted": true, "id": live_id }));
    let (_, l) = tools_call(&router, &token, "list_automations", json!({ "project_id": project_id })).await;
    assert!(l["automations"].as_array().unwrap().iter().all(|x| x["id"] != live_id.as_str()), "gone from the list");
    let (_, r) = tools_call(&router, &token, "list_automation_runs", json!({ "project_id": project_id })).await;
    assert!(r["runs"].as_array().unwrap().iter().all(|x| x["automation_id"] != live_id.as_str()), "its runs went with it: {r}");
    assert!(tools_call_refused(&router, &token, "delete_automation", json!({ "id": live_id })).await, "deleting twice is refused");
}
