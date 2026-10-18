//! Automations (`AutomationService`): per-project rules run after task
//! changes (`engine`) and by a periodic job for the time-based triggers.

pub(crate) mod automation_service;
pub(crate) mod engine;
pub(crate) mod record;

pub use automation_service::automation_router;
pub use engine::run_scheduled;
