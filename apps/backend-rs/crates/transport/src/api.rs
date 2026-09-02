//! Permukaan service in-process: fungsi yang sama persis dengan yang dipanggil
//! handler Connect, tanpa extractor axum.
//!
//! Ada supaya crate `mcp` bisa memakai ulang logika bisnis apa adanya —
//! member-gating, validasi, activity record, notifikasi, dan search index ikut
//! serta. Menduplikasi aturan itu di sisi MCP adalah cara paling cepat membuat
//! AI dan UI berbeda perilaku secara diam-diam.

pub use crate::work::task_service::{
    create_task_core, get_task_core, list_tasks_core, move_task_core, update_task_core,
};
