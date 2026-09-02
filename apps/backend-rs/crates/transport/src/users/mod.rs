//! Users & Auth: Connect handlers for `AuthService` + `UserDirectoryService`,
//! orchestrating `domain` rules, the per-op `persistence::Store`, and `auth`
//! (Argon2id + JWT). See docs/superpowers/specs/2026-07-29-users-auth-flow-design.md.

mod auth_service;
mod directory_service;
pub(crate) mod record;

pub use auth_service::auth_router;
pub use directory_service::user_router;

use connectrpc_axum::ConnectError;

/// JWT signing config, injected as a request extension into the auth router.
#[derive(Debug, Clone)]
pub struct JwtConfig {
    pub secret: String,
    /// Token lifetime in seconds (parsed from `AUTH_JWT_EXPIRES_IN`).
    pub ttl_secs: i64,
}

/// RFC-3339 UTC timestamp for `created_at`/`last_login_at`/`changed_at`.
pub(crate) fn now_iso() -> String {
    use time::format_description::well_known::Rfc3339;
    use time::OffsetDateTime;
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}

/// Current unix seconds (for JWT `exp`).
pub(crate) fn now_unix() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp()
}

/// Map an internal error to a Connect `internal` status (never leaks specifics).
pub(crate) fn internal(e: impl std::fmt::Display) -> ConnectError {
    ConnectError::new_internal(e.to_string())
}

/// Parse a user-supplied id string into a `pid`, or `not_found` (never 500 on
/// a malformed id).
pub(crate) fn parse_pid(id: &str) -> Result<i64, ConnectError> {
    id.parse::<i64>()
        .map_err(|_| ConnectError::new_not_found("user not found"))
}
