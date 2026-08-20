//! Export: taking a project out of the app.
//! See docs/superpowers/specs/2026-08-20-project-export-design.md.

mod csv;
mod export_service;
mod gather;
mod model;

pub use export_service::export_router;

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::ConnectError;
use persistence::Store;

use crate::projects::record::{load_project, ProjectRecord};

pub(crate) type StoreExt = Extension<Arc<Store>>;

pub(crate) fn internal(e: impl std::fmt::Display) -> ConnectError {
    ConnectError::new_internal(e.to_string())
}

pub(crate) fn parse_pid(id: &str) -> Result<i64, ConnectError> {
    id.parse::<i64>()
        .map_err(|_| ConnectError::new_not_found("project not found"))
}

pub(crate) fn require_auth(user: Option<Extension<AuthUser>>) -> Result<AuthUser, ConnectError> {
    user.map(|Extension(u)| u)
        .ok_or_else(|| ConnectError::new_unauthenticated("authentication required"))
}

pub(crate) async fn require_project(store: &Store, pid: i64) -> Result<ProjectRecord, ConnectError> {
    load_project(store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("project not found"))
}

/// Export is a consequential operation: one action that carries a whole project
/// out of the app. Same gate as delete/transfer.
pub(crate) fn require_owner_or_admin(
    auth: &AuthUser,
    project: &ProjectRecord,
) -> Result<(), ConnectError> {
    if auth.is_admin() || project.owner_id == auth.id {
        Ok(())
    } else {
        Err(ConnectError::new_permission_denied("owner or admin only"))
    }
}

/// Filename-safe stem from a project name: "Toko Bunga / Q3" → "toko-bunga-q3".
/// Empty or all-punctuation names fall back to "project".
pub(crate) fn file_slug(name: &str) -> String {
    let mut out = String::new();
    let mut last_dash = true;
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let s = out.trim_matches('-').to_string();
    if s.is_empty() {
        "project".to_string()
    } else {
        s
    }
}

#[cfg(test)]
mod tests {
    use super::file_slug;

    #[test]
    fn slug_is_filename_safe() {
        assert_eq!(file_slug("Toko Bunga / Q3"), "toko-bunga-q3");
        assert_eq!(file_slug("  spaced  out  "), "spaced-out");
        assert_eq!(file_slug("///"), "project");
        assert_eq!(file_slug(""), "project");

        // ASCII-only is deliberate, not a bug: it keeps the result safe to use
        // both as a filename and as a path inside an archive (Phase 2 reuses
        // this for ZIP entry names). Non-ASCII letters are dropped rather than
        // transliterated, so an accented letter becomes a separator mid-word,
        // and a name with no ASCII alphanumerics at all falls back to "project".
        assert_eq!(file_slug("Proyék Baru"), "proy-k-baru");
        assert_eq!(file_slug("日本語"), "project");
    }
}
