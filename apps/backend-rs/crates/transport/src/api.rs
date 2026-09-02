//! In-process service surface: the exact same functions the Connect handlers
//! call, minus the axum extractors.
//!
//! Exists so the `mcp` crate can reuse the business logic as-is — member-gating,
//! validation, activity recording, notifications, and search indexing all come
//! along for the ride. Duplicating those rules on the MCP side is the fastest
//! way to make AI and UI behavior silently diverge.

pub use crate::work::task_service::{
    create_task_core, get_task_core, list_tasks_core, move_task_core, update_task_core,
};
