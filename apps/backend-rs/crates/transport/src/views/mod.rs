//! Saved views (`SavedViewService`): named filters over a project's Tasks tab.
//! Member-gated; personal unless shared.

mod record;
pub(crate) mod view_service;

pub use view_service::view_router;
