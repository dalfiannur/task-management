//! Transport: generated Connect types + HealthService handlers.
//!
//! The generated module tree (from `proto/health.proto`) is included below;
//! health types live at `crate::sedjiwa::tasks::health::v1`.
//!
//! Note: connectrpc-axum's no-extractor unary handler impl is fixed to router
//! state `()`, so we keep the builder at `S = ()` and inject shared state via
//! `Extension` (state-independent) layered onto the router — not axum `State`.

// `ConnectError` (connectrpc-axum) is a large enum, so every Connect handler's
// `Result<_, ConnectError>` trips `result_large_err`; boxing isn't possible (the
// handler signatures are fixed by the framework). `useless_borrows_in_formatting`
// fires inside the generated proto code (included below), not our own.
#![allow(clippy::result_large_err, clippy::useless_borrows_in_formatting)]

include!(concat!(env!("OUT_DIR"), "/generated.rs"));

mod pages;
mod projects;
mod users;
mod work;
pub use pages::page_router;
pub use projects::project_router;
pub use users::{auth_router, user_router, JwtConfig};
pub use work::{module_router, task_router};

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::HeartbeatAt;
use persistence::Store;

use sedjiwa::tasks::health::v1 as pb;
use sedjiwa::tasks::health::v1::health_service_connect::HealthServiceBuilder;

/// Liveness — no auth, no DB.
async fn check(
    _req: ConnectRequest<pb::CheckRequest>,
) -> Result<ConnectResponse<pb::CheckResponse>, ConnectError> {
    Ok(ConnectResponse::new(pb::CheckResponse {
        status: "ok".into(),
    }))
}

/// Prove Arke↔Postgres: write a heartbeat, read it back from the DB.
async fn db_check(
    Extension(store): Extension<Arc<Store>>,
    _req: ConnectRequest<pb::DbCheckRequest>,
) -> Result<ConnectResponse<pb::DbCheckResponse>, ConnectError> {
    let pid = store
        .create((HeartbeatAt { ts: now_iso() },))
        .await
        .map_err(|e| ConnectError::new_internal(e.to_string()))?;
    let hb = store
        .get::<HeartbeatAt>(pid)
        .await
        .map_err(|e| ConnectError::new_internal(e.to_string()))?
        .ok_or_else(|| ConnectError::new_internal("heartbeat missing after write"))?;
    Ok(ConnectResponse::new(pb::DbCheckResponse {
        heartbeat_id: pid.to_string(),
        ts: hb.ts,
    }))
}

/// Guarded: returns the authenticated user id from the request extension.
async fn who_am_i(
    user: Option<Extension<AuthUser>>,
    _req: ConnectRequest<pb::WhoAmIRequest>,
) -> Result<ConnectResponse<pb::WhoAmIResponse>, ConnectError> {
    match user {
        Some(Extension(u)) => Ok(ConnectResponse::new(pb::WhoAmIResponse { user_id: u.id })),
        None => Err(ConnectError::new_unauthenticated("authentication required")),
    }
}

/// Assemble the HealthService router, injecting the Store as a request extension.
pub fn health_router(store: Arc<Store>) -> axum::Router<()> {
    // `T` (the extractor tuple) only appears in a where-clause bound on the generated
    // builder methods, so it can't be inferred through the `ConnectHandlerWrapper`
    // indirection — pin it explicitly. Shape: `(extractors.., ConnectRequest<Req>,)`.
    HealthServiceBuilder::<()>::new()
        .check::<_, (ConnectRequest<pb::CheckRequest>,)>(check)
        .db_check::<_, (Extension<Arc<Store>>, ConnectRequest<pb::DbCheckRequest>)>(db_check)
        .who_am_i::<_, (Option<Extension<AuthUser>>, ConnectRequest<pb::WhoAmIRequest>)>(who_am_i)
        .build()
        .layer(Extension(store))
}

fn now_iso() -> String {
    use time::format_description::well_known::Rfc3339;
    use time::OffsetDateTime;
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}
