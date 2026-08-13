//! Search: the write-path indexer other services call, plus the read-path
//! `SearchService`. See docs/…/2026-08-12-search-and-task-permalink-design.md.

// The read path (`search_service`) is wired below and fully used. The
// write-path indexer builders (`index`, `deindex`, `deindex_project`,
// `task_doc`, `page_doc`, `comment_doc`, `project_doc`, `user_doc`) have no
// call sites yet — later tasks add them (index tasks, pages, comments,
// projects, people) — so they and this re-export stay dead by construction
// until then, same as the other intentional gaps this crate allows explicitly
// rather than papering over (see the handler-signature allows atop `lib.rs`).
#![allow(dead_code, unused_imports)]

mod indexer;
mod search_service;

pub use search_service::search_router;

pub(crate) use indexer::{
    comment_doc, deindex, deindex_project, index, kind, page_doc, project_doc, task_doc, user_doc,
};
