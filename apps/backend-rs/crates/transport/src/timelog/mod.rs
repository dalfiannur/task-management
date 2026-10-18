//! Time tracking (`TimeService`): timer runs and hand-logged minutes on tasks.
//! Member-gated through the task's project; authors (or admins) edit.

pub(crate) mod record;
pub(crate) mod time_service;

pub use time_service::time_router;
