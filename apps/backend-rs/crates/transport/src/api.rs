//! In-process service surface: the exact same functions the Connect handlers
//! call, minus the axum extractors.
//!
//! Exists so the `mcp` crate can reuse the business logic as-is — member-gating,
//! validation, activity recording, notifications, and search indexing all come
//! along for the ride. Duplicating those rules on the MCP side is the fastest
//! way to make AI and UI behavior silently diverge.
//!
//! Re-exports are grouped one block per domain module — the list grows with
//! the domain surface, not by accretion.
//!
//! One exception to "same functions the Connect handlers call": `find_by_hash`
//! and `auth_user_for` back no Connect handler at all. They exist so `mcp`'s
//! own PAT verification (`pat.rs`) can resolve a credential the same way the
//! rest of this crate resolves one, on a security-relevant seam where reusing
//! the real lookup — not a hand-rolled copy — is the point.

pub use crate::projects::project_service::{get_project_core, list_projects_core};
pub use crate::work::module_service::list_modules_core;
// `ListTasksRequest.project_id` is required, but the `list_tasks` MCP tool also
// accepts a bare `module_id`. `module_project` is the exact lookup
// `create_task_core`/`get_task_core`/etc. already use to derive a task's
// project from its module — reusing it here (rather than re-querying
// `ModuleProjectRef` locally) keeps that resolution in one place.
pub use crate::work::task_service::{
    create_task_core, get_task_core, list_tasks_core, module_project, move_task_core,
    update_task_core,
};
pub use crate::sedjiwa::tasks::work::v1 as work_pb;
pub use crate::comments::comment_service::{create_comment_core, list_comments_core};
pub use crate::search::search_service::search_core;
pub use crate::dashboard::mytasks_service::{
    list_assigned_to_me_core, list_created_by_me_core, list_involving_me_core,
};
// Not core fns: the PAT path resolves its own credential (see the module doc).
pub use crate::tokens::record::{find_by_hash, TokenRecord};
pub use crate::users::record::auth_user_for;
