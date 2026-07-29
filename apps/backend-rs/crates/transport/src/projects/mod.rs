//! Projects: Connect handler for `ProjectService` (delivery-only, per-op Store).
//! See docs/superpowers/specs/2026-07-29-create-project-flow-design.md.

mod project_service;
mod record;

pub use project_service::project_router;

use connectrpc_axum::ConnectError;

/// Map an internal error to a Connect `internal` status.
pub(crate) fn internal(e: impl std::fmt::Display) -> ConnectError {
    ConnectError::new_internal(e.to_string())
}
