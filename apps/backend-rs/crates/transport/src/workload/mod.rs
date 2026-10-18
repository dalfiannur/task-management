//! Workload (`WorkloadService`): remaining effort per person per week against
//! capacity, and the working-day calendars (global → project / user).

pub(crate) mod record;
pub(crate) mod workload_service;

pub use workload_service::workload_router;
