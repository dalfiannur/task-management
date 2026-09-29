//! Domain: the entity components and the rules over them, with no database
//! code. Each component struct is one row of its `cmp_*` table; the mapping
//! lives in `persistence::rows`.

pub mod activity;
pub mod comment;
pub mod label;
pub mod media;
pub mod module;
pub mod notification;
pub mod page;
pub mod project;
pub mod sanitize;
pub mod task;
pub mod token;
pub mod user;

/// A single timestamp, used only to prove the database round-trips (DbCheck).
#[derive(Debug, Clone)]
pub struct HeartbeatAt {
    /// ISO-8601 instant the heartbeat was written. Maps to a TEXT column.
    pub ts: String,
}
