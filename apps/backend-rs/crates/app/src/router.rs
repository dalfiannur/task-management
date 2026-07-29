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

    let origins: Vec<_> = cfg
        .cors_origins
        .iter()
        .filter_map(|o| o.parse().ok())
        .collect();
    let cors = CorsLayer::new()
        .allow_headers([AUTHORIZATION, CONTENT_TYPE])
        .allow_methods(Any)
        .allow_origin(AllowOrigin::list(origins));

    transport::health_router(store)
        .layer(axum::middleware::from_fn_with_state(secret, auth_layer))
        .layer(cors)
}
