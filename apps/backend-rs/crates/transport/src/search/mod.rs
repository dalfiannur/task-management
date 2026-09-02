//! Search: the write-path indexer other services call, plus the read-path
//! `SearchService`. See docs/…/2026-08-12-search-and-task-permalink-design.md.

mod indexer;
pub(crate) mod search_service;

pub use search_service::search_router;

pub(crate) use indexer::{
    comment_doc, deindex, deindex_project, index, kind, page_doc, project_doc, task_doc, user_doc,
};
