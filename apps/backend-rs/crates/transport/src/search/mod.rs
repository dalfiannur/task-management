//! Search: the write-path indexer other services call, plus the read-path
//! `SearchService`. See docs/…/2026-08-12-search-and-task-permalink-design.md.

// Nothing calls the indexer yet — later tasks add the call sites (index tasks,
// pages, comments, projects, people) and restore `search_service` below. Until
// then this module is unused by construction, same as the other intentional
// gaps this crate allows explicitly rather than papering over (see the
// handler-signature allows atop `lib.rs`).
#![allow(dead_code, unused_imports)]

mod indexer;
// `search_service` lands in a later task (SearchService read path); until then
// there is nothing to route requests to.
// mod search_service;

// pub use search_service::search_router;

pub(crate) use indexer::{
    comment_doc, deindex, deindex_project, index, kind, page_doc, project_doc, task_doc, user_doc,
};
