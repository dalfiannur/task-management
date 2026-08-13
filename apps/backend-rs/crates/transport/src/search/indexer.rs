//! The shared index helpers other services call after a successful mutation.
//! Best-effort, exactly like `activity::record`: a failure is logged, never
//! propagated to the triggering action. The index may lag; `bin/reindex` is the
//! remedy.

use persistence::{SearchDoc, Store};

/// Document kinds. These strings are the contract between the indexer, the
/// search handler, and the proto enum — change them in all three or nowhere.
pub(crate) mod kind {
    pub const TASK: &str = "task";
    pub const PAGE: &str = "page";
    pub const COMMENT: &str = "comment";
    pub const PROJECT: &str = "project";
    pub const USER: &str = "user";
}

pub(crate) async fn index(store: &Store, doc: SearchDoc) {
    let kind = doc.kind.clone();
    let id = doc.entity_id.clone();
    if let Err(e) = store.index_doc(doc).await {
        tracing::warn!(error = %e, kind = %kind, id = %id, "failed to index document");
    }
}

pub(crate) async fn deindex(store: &Store, kind: &str, entity_id: &str) {
    if let Err(e) = store.deindex_doc(kind, entity_id).await {
        tracing::warn!(error = %e, kind = %kind, id = %entity_id, "failed to deindex document");
    }
}

pub(crate) async fn deindex_project(store: &Store, project_id: &str) {
    if let Err(e) = store.deindex_project(project_id).await {
        tracing::warn!(error = %e, project = %project_id, "failed to deindex project");
    }
}

/// Build a task document. `body` is the description projected to plain text.
pub(crate) fn task_doc(
    id: &str,
    project_id: &str,
    title: &str,
    description: &str,
    assignee_ids: Vec<String>,
) -> SearchDoc {
    SearchDoc {
        kind: kind::TASK.into(),
        entity_id: id.into(),
        project_id: Some(project_id.into()),
        title: title.into(),
        body: domain::sanitize::plain_text(description),
        assignee_ids,
    }
}

pub(crate) fn page_doc(id: &str, project_id: &str, title: &str, content: &str) -> SearchDoc {
    SearchDoc {
        kind: kind::PAGE.into(),
        entity_id: id.into(),
        project_id: Some(project_id.into()),
        title: title.into(),
        body: domain::sanitize::plain_text(content),
        assignee_ids: vec![],
    }
}

/// A comment has no title, so it ranks purely on body weight — correct, since a
/// comment is body by nature.
pub(crate) fn comment_doc(id: &str, project_id: &str, content: &str) -> SearchDoc {
    SearchDoc {
        kind: kind::COMMENT.into(),
        entity_id: id.into(),
        project_id: Some(project_id.into()),
        title: String::new(),
        body: domain::sanitize::plain_text(content),
        assignee_ids: vec![],
    }
}

pub(crate) fn project_doc(id: &str, name: &str, description: &str) -> SearchDoc {
    SearchDoc {
        kind: kind::PROJECT.into(),
        entity_id: id.into(),
        // A project's own id, so the membership filter covers it like any child.
        project_id: Some(id.into()),
        title: name.into(),
        body: domain::sanitize::plain_text(description),
        assignee_ids: vec![],
    }
}

/// People are global: `project_id` is `None`, so they pass the membership
/// filter for every authenticated caller — matching `search_users` today.
pub(crate) fn user_doc(id: &str, display_name: &str, phone: &str) -> SearchDoc {
    SearchDoc {
        kind: kind::USER.into(),
        entity_id: id.into(),
        project_id: None,
        title: display_name.into(),
        body: phone.into(),
        assignee_ids: vec![],
    }
}
