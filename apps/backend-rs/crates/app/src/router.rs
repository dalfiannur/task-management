use std::sync::Arc;

use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::Router;
use persistence::Store;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};

use crate::config::Config;
use crate::interceptor::auth_layer;

/// Build the app router: HealthService (with the Store injected as an extension),
/// wrapped with the JWT auth middleware and CORS.
pub fn build_router(cfg: &Config, store: Arc<Store>) -> Router {
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
        .merge(transport::page_router(store))
        .layer(axum::middleware::from_fn_with_state(secret, auth_layer))
        .layer(cors)
}
