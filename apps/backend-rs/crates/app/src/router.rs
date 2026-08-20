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

    // Merge all service routers, then apply JWT extraction + CORS over the whole API.
    transport::health_router(store.clone())
        .merge(transport::auth_router(store.clone(), jwt))
        .merge(transport::user_router(store.clone()))
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
        .merge(transport::notification_router(store, notifier.clone()))
        // Innermost: protocol detection + Connect Context (required for
        // server-streaming, e.g. StreamNotifications; unary otherwise falls
        // back to header detection). Wraps the handler's response directly.
        .layer(ConnectLayer::new())
        // Global: mutating handlers extract the Notifier to emit.
        .layer(Extension(notifier))
        .layer(axum::middleware::from_fn_with_state(secret, auth_layer))
        .layer(cors)
}
