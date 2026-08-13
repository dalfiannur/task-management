//! Work: Modules & Tasks (all-tasks tab). Two services on the per-op Store; the
//! owning project is derived from the module (task → module → project) for
//! membership/ownership guards. See docs/…/project-all-tasks-tab-flow-design.md.
//!
//! Deferred (systems not built yet): activity + notification emits (spec §4.7).

mod module_service;
pub(crate) mod record;
pub(crate) mod task_record;
mod task_service;

pub use module_service::module_router;
pub use task_service::task_router;

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::ConnectError;
use persistence::Store;

use crate::projects::record::{is_member, load_project};

pub(crate) fn internal(e: impl std::fmt::Display) -> ConnectError {
    ConnectError::new_internal(e.to_string())
}

/// Parse a user-supplied id into a `pid`, or `not_found`.
pub(crate) fn parse_pid(id: &str) -> Result<i64, ConnectError> {
    id.parse::<i64>()
        .map_err(|_| ConnectError::new_not_found("not found"))
}

pub(crate) fn require_auth(user: Option<Extension<AuthUser>>) -> Result<AuthUser, ConnectError> {
    user.map(|Extension(u)| u)
        .ok_or_else(|| ConnectError::new_unauthenticated("authentication required"))
}

/// Caller must be a member of `project_id` (admin bypasses).
pub(crate) async fn require_member(
    store: &Store,
    project_id: &str,
    auth: &AuthUser,
) -> Result<(), ConnectError> {
    if auth.is_admin() {
        return Ok(());
    }
    if is_member(store, project_id, &auth.id)
        .await
        .map_err(internal)?
    {
        Ok(())
    } else {
        Err(ConnectError::new_permission_denied("not a member"))
    }
}

/// Caller must be the project owner or an admin.
pub(crate) async fn require_owner_or_admin(
    store: &Store,
    project_id: &str,
    auth: &AuthUser,
) -> Result<(), ConnectError> {
    if auth.is_admin() {
        return Ok(());
    }
    let pid = project_id
        .parse::<i64>()
        .map_err(|_| ConnectError::new_not_found("project not found"))?;
    let p = load_project(store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("project not found"))?;
    if p.owner_id == auth.id {
        Ok(())
    } else {
        Err(ConnectError::new_permission_denied("owner or admin required"))
    }
}

/// Store injected into both work routers (kept here so `Arc` is imported once).
pub(crate) type StoreExt = Extension<Arc<Store>>;

/// Resolve a task's owning project (task → module → project), or `None` if the
/// task/module is missing or the id is malformed. Used cross-module (e.g. media
/// link validation).
pub(crate) async fn task_project_id(
    store: &Store,
    task_id: &str,
) -> anyhow::Result<Option<String>> {
    let Ok(tpid) = task_id.parse::<i64>() else {
        return Ok(None);
    };
    let Some(t) = task_record::load_task(store, tpid).await? else {
        return Ok(None);
    };
    let Ok(mpid) = t.module_id.parse::<i64>() else {
        return Ok(None);
    };
    Ok(record::load_module(store, mpid)
        .await?
        .map(|m| m.project_id))
}

/// Validate a proposed parent for `child_pid` (which may be 0 on create).
///
/// Returns the parent's module id, because a subtask always lives in its
/// parent's module and the caller needs it. Rejects: a missing parent, a parent
/// in another project, a parent that is itself a subtask (the one-level rule),
/// and a task parenting itself.
pub(crate) async fn validate_parent(
    store: &Store,
    project_id: &str,
    parent_id: &str,
    child_pid: i64,
) -> Result<String, ConnectError> {
    let ppid = parse_pid(parent_id)?;
    if ppid == child_pid {
        return Err(ConnectError::new_invalid_argument(
            "a task cannot be its own parent",
        ));
    }
    let parent = task_record::load_task(store, ppid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("parent task not found"))?;
    if parent.parent_id.is_some() {
        return Err(ConnectError::new_invalid_argument(
            "a subtask cannot have subtasks",
        ));
    }
    let parent_project = task_project_id(store, parent_id)
        .await
        .map_err(internal)?
        .unwrap_or_default();
    if parent_project != project_id {
        return Err(ConnectError::new_invalid_argument(
            "parent task must be in the same project",
        ));
    }
    Ok(parent.module_id)
}

/// Validate `blocked_by` ids for a task in `project_id`. Rejects a
/// self-dependency and any id outside the project. Duplicates are collapsed.
///
/// Deliberately does NOT look for cycles: dependencies only warn, and conflicts
/// are computed per edge, so nothing ever walks the chain. See the spec's
/// "Consequence: no cycle detection is needed".
pub(crate) async fn validate_blocked_by(
    store: &Store,
    project_id: &str,
    task_pid: i64,
    ids: &[String],
) -> Result<Vec<String>, ConnectError> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for id in ids {
        if id == &task_pid.to_string() {
            return Err(ConnectError::new_invalid_argument(
                "a task cannot block itself",
            ));
        }
        if !seen.insert(id.clone()) {
            continue;
        }
        let owner = task_project_id(store, id).await.map_err(internal)?;
        match owner {
            Some(p) if p == project_id => out.push(id.clone()),
            _ => {
                return Err(ConnectError::new_invalid_argument(
                    "every dependency must be a task in the same project",
                ))
            }
        }
    }
    Ok(out)
}

/// Subtask `pid`s of a parent (for cascade delete and module moves).
pub(crate) async fn subtask_pids(store: &Store, parent_id: &str) -> anyhow::Result<Vec<i64>> {
    let p = parent_id.to_string();
    store
        .query::<domain::task::TaskParent, i64>(None, move |world, pairs| {
            pairs
                .iter()
                .filter(|(_, e)| {
                    world
                        .get::<domain::task::TaskParent>(*e)
                        .map(|r| r.parent_id == p)
                        .unwrap_or(false)
                })
                .map(|(pid, _)| *pid)
                .collect()
        })
        .await
}

/// Remove `gone_id` from every task in the project that listed it as a blocker.
///
/// Called after a task is deleted. Without it `blocked_by` accumulates ids that
/// resolve to nothing: the frontend skips them when building conflicts, so they
/// are invisible rather than broken — which is exactly why they would otherwise
/// never get cleaned up.
pub(crate) async fn strip_dependency(
    store: &Store,
    project_id: &str,
    gone_id: &str,
) -> anyhow::Result<()> {
    let module_ids: std::collections::HashSet<String> = record::modules_for_project(store, project_id)
        .await?
        .into_iter()
        .map(|m| m.pid.to_string())
        .collect();
    for t in task_record::tasks_for_modules(store, module_ids).await? {
        if !t.blocked_by_ids.iter().any(|b| b == gone_id) {
            continue;
        }
        let kept: Vec<String> = t
            .blocked_by_ids
            .iter()
            .filter(|b| *b != gone_id)
            .cloned()
            .collect();
        store
            .update(t.pid, move |w, e| {
                w.remove::<domain::task::TaskBlockedBy>(e);
                w.insert(e, domain::task::TaskBlockedBy { task_ids: kept });
            })
            .await?;
    }
    Ok(())
}

/// Drop a deleted task and its comments from the search index.
///
/// A task's comments are not entity-deleted with it (they are already
/// unreachable, since every comment read resolves through its task), but they
/// ARE indexed. Leaving them behind makes search the one place a deleted task's
/// discussion still surfaces — a result that opens nothing. Both delete paths
/// call this: `delete_task` directly, and `delete_module` for every task it
/// cascades over.
pub(crate) async fn deindex_task_and_comments(store: &Store, task_id: &str) {
    crate::search::deindex(store, crate::search::kind::TASK, task_id).await;
    let comments = match crate::comments::record::comments_for_task(store, task_id).await {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, task = %task_id, "failed to list comments for deindexing");
            return;
        }
    };
    for c in comments {
        crate::search::deindex(store, crate::search::kind::COMMENT, &c.pid.to_string()).await;
    }
}
