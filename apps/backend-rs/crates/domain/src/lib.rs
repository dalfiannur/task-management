//! Domain: ECS components and rules. Skeleton: only the Heartbeat component.
//!
//! arke note: `Component` is a blanket-impl marker trait (any `'static + Send`
//! type is a component), so no `#[derive(Component)]` exists. Persistable
//! components derive `PgComponent` (arke-postgres); named-field structs only.

use arke_postgres::PgComponent;

pub mod user;

/// Register every persisted component on a fresh `PgStore`. Shared by the server
/// and the seed binary so the schema stays in one place.
pub fn register_all(pg: &mut arke_postgres::PgStore) {
    pg.register::<HeartbeatAt>();
    pg.register::<user::UserPhone>();
    pg.register::<user::UserPassword>();
    pg.register::<user::UserProfile>();
    pg.register::<user::UserStatusComponent>();
    pg.register::<user::AdminMark>();
}

/// Skeleton entity: a single timestamp, used only to prove Arke↔Postgres round-trips.
#[derive(PgComponent, Debug, Clone)]
pub struct HeartbeatAt {
    /// ISO-8601 instant the heartbeat was written. Maps to a TEXT column.
    pub ts: String,
}
