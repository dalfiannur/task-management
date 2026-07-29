//! Projects: Connect handler for `ProjectService` (delivery-only, per-op Store).
//! See docs/superpowers/specs/2026-07-29-create-project-flow-design.md.

mod project_service;
pub(crate) mod record;

pub use project_service::project_router;

use connectrpc_axum::ConnectError;

/// Map an internal error to a Connect `internal` status.
pub(crate) fn internal(e: impl std::fmt::Display) -> ConnectError {
    ConnectError::new_internal(e.to_string())
}

/// Parse a user-supplied id into a `pid`, or `not_found` on a malformed id.
pub(crate) fn parse_pid(id: &str) -> Result<i64, ConnectError> {
    id.parse::<i64>()
        .map_err(|_| ConnectError::new_not_found("project not found"))
}
