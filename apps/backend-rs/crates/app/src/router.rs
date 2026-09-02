use std::sync::Arc;

use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::{Extension, Router};
use connectrpc_axum::ConnectLayer;
use persistence::Store;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};

use storage::Storage;
use transport::Notifier;

use crate::config::Config;
use crate::interceptor::auth_layer;

/// Build the app router: all services (Store injected as an extension; Media also
/// gets the object Storage; the Notifier is layered globally so mutating handlers
/// can emit notifications), wrapped with the JWT auth middleware and CORS.
pub fn build_router(
    cfg: &Config,
    store: Arc<Store>,
    media_storage: Arc<dyn Storage>,
    notifier: Arc<Notifier>,
) -> Router {
    let secret: Arc<str> = Arc::from(cfg.jwt_secret.as_str());
    let jwt = Arc::new(transport::JwtConfig {
        secret: cfg.jwt_secret.clone(),
        ttl_secs: cfg.jwt_ttl_secs(),
    });

    let origins: Vec<_> = cfg
        .cors_origins
        .iter()
        .filter_map(|o| o.parse().ok())
        .collect();
    let cors = CorsLayer::new()
        .allow_headers([AUTHORIZATION, CONTENT_TYPE])
        .allow_methods(Any)
        .allow_origin(AllowOrigin::list(origins));

    // Merge all Connect service routers, then apply JWT extraction + the
    // Connect protocol layer over just that part of the API.
    let connect_api = transport::health_router(store.clone())
        .merge(transport::auth_router(store.clone(), jwt))
        .merge(transport::user_router(store.clone()))
        .merge(transport::token_router(store.clone()))
        .merge(transport::project_router(store.clone()))
        .merge(transport::module_router(store.clone()))
        .merge(transport::task_router(store.clone()))
        .merge(transport::page_router(store.clone()))
        .merge(transport::label_router(store.clone()))
        .merge(transport::comment_router(store.clone()))
        .merge(transport::media_router(store.clone(), media_storage))
        .merge(transport::activity_router(store.clone()))
        .merge(transport::dashboard_router(store.clone()))
        .merge(transport::mytasks_router(store.clone()))
        .merge(transport::search_router(store.clone()))
        .merge(transport::export_router(store.clone()))
        .merge(transport::notification_router(store.clone(), notifier.clone()))
        // Innermost: protocol detection + Connect Context (required for
        // server-streaming, e.g. StreamNotifications; unary otherwise falls
        // back to header detection). Wraps the handler's response directly.
        .layer(ConnectLayer::new())
        // Global: mutating handlers extract the Notifier to emit.
        .layer(Extension(notifier.clone()))
        .layer(axum::middleware::from_fn_with_state(secret, auth_layer));

    // MCP has its own credential path (PAT), so it's deliberately nested in
    // after the Connect stack's layers above, not before: it must not be
    // wrapped in `ConnectLayer` and must not go through the JWT `auth_layer`.
    // CORS still applies to the whole API.
    connect_api
        .nest("/mcp", mcp::mcp_router(store, notifier))
        .layer(cors)
}

/// Pins the layering built above: `.nest("/mcp", ...)` must stay *after* the
/// Connect stack's `.layer()` calls, not merged back into the chain that gets
/// wrapped in `ConnectLayer`/`auth_layer`. That mistake compiles, runs, and
/// passes every other test in the workspace — `crates/mcp`'s own tests build
/// `mcp_router` against a bare `Router::new()` and never go through
/// `build_router`, so nothing else in the suite would catch it regressing.
///
/// `app` is a binary crate (no `[lib]`), so these can't live as a
/// `crates/app/tests/*.rs` integration test importing `app::...` — there is
/// no library target to import. A unit test module here, with access to
/// `build_router` as a same-crate private item, is the only place that can
/// reach it.
#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::extract::Request;
    use axum::http::StatusCode;
    use tower::ServiceExt;

    const SECRET: &str = "router-test-secret";

    /// No S3/RustFS needed: neither assertion below touches media.
    #[derive(Default)]
    struct FakeStorage;
    #[async_trait::async_trait]
    impl storage::Storage for FakeStorage {
        async fn presign_put(&self, key: &str, _mime: &str, _ttl: u32) -> anyhow::Result<String> {
            Ok(format!("http://fake/put/{key}"))
        }
        async fn presign_get(&self, key: &str, _ttl: u32) -> anyhow::Result<String> {
            Ok(format!("http://fake/get/{key}"))
        }
        async fn head(&self, _key: &str) -> anyhow::Result<Option<u64>> {
            Ok(None)
        }
        async fn delete(&self, _key: &str) -> anyhow::Result<()> {
            Ok(())
        }
    }

    /// Say so, loudly, when a test is about to no-op: cargo counts an early
    /// return as a pass, and a run that prints nothing is a run that tested
    /// nothing (same convention as `crates/mcp/tests/mcp_flow.rs`).
    fn skipped() {
        let name = std::thread::current().name().unwrap_or("test").to_string();
        eprintln!("SKIP {name}: DATABASE_URL is not set, this test asserted nothing");
    }

    async fn router() -> Option<Router> {
        let url = std::env::var("DATABASE_URL").ok()?;
        let store = Arc::new(
            Store::connect(&url, domain::register_all)
                .await
                .unwrap(),
        );
        let media_storage: Arc<dyn Storage> = Arc::new(FakeStorage);
        let notifier = Arc::new(Notifier::new());
        let cfg = Config {
            database_url: url,
            jwt_secret: SECRET.to_string(),
            jwt_expires_in: "7d".to_string(),
            port: 0,
            cors_origins: vec!["http://localhost:3001".to_string()],
        };
        Some(build_router(&cfg, store, media_storage, notifier))
    }

    /// Pins `/mcp` being outside `ConnectLayer`, not just outside `auth_layer`.
    ///
    /// An earlier version of this test sent a valid session JWT (no PAT) to
    /// `/mcp` and asserted 401, on the theory that `auth_layer` populating
    /// the `AuthUser` extension from that JWT would leak through if MCP were
    /// wrongly nested inside the Connect stack's `.layer()` chain. That
    /// theory doesn't hold: `mcp::handle_post` never reads any `AuthUser`
    /// extension — it always re-parses the raw `Authorization` header itself
    /// via `pat::authenticate`, which rejects a JWT as "not shaped like a
    /// token" regardless of what ran before it. Moving `.nest("/mcp", ...)`
    /// back inside the layer chain was verified by hand to leave that test
    /// passing, so it was replaced with this one.
    ///
    /// `ConnectLayer`, unlike `auth_layer`, *does* reject outright: its
    /// pre-protocol check treats a missing/unrecognised `Content-Type` as
    /// `RequestProtocol::Unknown` and answers 415 itself, before the request
    /// ever reaches a handler (see `connectrpc-axum`'s
    /// `check_protocol_negotiation`). `mcp::handle_post` doesn't look at
    /// `Content-Type` at all, so a content-type-less request succeeding here
    /// is exactly what proves `/mcp` never passes through `ConnectLayer`. If
    /// `.nest("/mcp", ...)` above ever moves back inside the Connect stack's
    /// `.layer()` chain, this starts failing with 415 instead of answering
    /// the RPC (verified by hand: moving the `.nest()` call flips this
    /// assertion from 200 to 415).
    #[tokio::test]
    async fn mcp_is_not_gated_by_the_connect_protocol_layer() {
        let Some(router) = router().await else {
            skipped();
            return;
        };
        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": { "protocolVersion": "2025-06-18" }
        });
        let req = Request::builder()
            .method("POST")
            .uri("/mcp")
            // Deliberately no Content-Type header.
            .body(Body::from(body.to_string()))
            .unwrap();
        let resp = router.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    /// The other half of the same pin: a Connect route with no credentials
    /// must still be 401, proving `auth_layer` is still attached to the
    /// Connect subtree after the restructuring that carved MCP out of it.
    #[tokio::test]
    async fn connect_route_without_a_token_is_still_unauthorized() {
        let Some(router) = router().await else {
            skipped();
            return;
        };
        let req = Request::builder()
            .method("POST")
            .uri("/sedjiwa.tasks.project.v1.ProjectService/ListProjects")
            .header(CONTENT_TYPE, "application/json")
            .body(Body::from(serde_json::json!({}).to_string()))
            .unwrap();
        let resp = router.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }
}
