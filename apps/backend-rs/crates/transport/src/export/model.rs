//! What one project looks like on its way out of the app. Deliberately neither
//! proto nor Arke components: this is the shape that lands on disk and is read
//! by people who do not have this codebase.

use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize)]
pub(crate) struct ProjectSnapshot {
    pub project: ProjectOut,
    /// Everyone referenced anywhere in the archive. Id and name only — see the
    /// PII decision in the spec.
    pub users: Vec<UserOut>,
    pub modules: Vec<ModuleOut>,
    pub tasks: Vec<TaskOut>,
    pub labels: Vec<LabelOut>,
    pub comments: Vec<CommentOut>,
    pub pages: Vec<PageOut>,
    pub activity: Vec<ActivityOut>,
    pub media: Vec<MediaOut>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub(crate) struct ProjectOut {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub owner_id: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub member_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct UserOut {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ModuleOut {
    pub id: String,
    pub name: String,
    pub description: String,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct TaskOut {
    pub id: String,
    pub module_id: String,
    pub title: String,
    pub description: String,
    pub status: String,
    pub priority: String,
    pub start_date: Option<String>,
    pub due_date: Option<String>,
    pub completed_at: Option<String>,
    pub sort_order: i32,
    pub assignee_ids: Vec<String>,
    pub label_ids: Vec<String>,
    pub parent_id: Option<String>,
    pub blocked_by_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub created_by: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct LabelOut {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct CommentOut {
    pub id: String,
    pub task_id: String,
    pub author_id: String,
    pub content: String,
    pub mentioned_user_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct PageOut {
    pub id: String,
    pub title: String,
    pub icon: String,
    pub content: String,
    pub sort_order: i32,
    pub created_by: String,
    pub last_edited_by: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ActivityOut {
    pub id: String,
    pub actor_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub action: String,
    pub summary: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct MediaOut {
    pub id: String,
    pub file_name: String,
    pub mime_type: String,
    pub size: i64,
    pub uploaded_by: String,
    pub created_at: String,
    pub task_ids: Vec<String>,
    /// Storage key — needed to fetch the bytes, dropped before serialization in
    /// Phase 2 (`path` replaces it in the archive manifest).
    #[serde(skip)]
    pub storage_key: String,
}
