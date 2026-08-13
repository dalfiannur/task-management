//! Domain: ECS components and rules. Skeleton: only the Heartbeat component.
//!
//! arke note: `Component` is a blanket-impl marker trait (any `'static + Send`
//! type is a component), so no `#[derive(Component)]` exists. Persistable
//! components derive `PgComponent` (arke-postgres); named-field structs only.

use arke_postgres::PgComponent;

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
pub mod user;

/// Register every persisted component on a fresh `PgStore`. Shared by the server
/// and the seed binary so the schema stays in one place.
pub fn register_all(pg: &mut arke_postgres::PgStore) {
    pg.register::<HeartbeatAt>();
    // Users.
    pg.register::<user::UserPhone>();
    pg.register::<user::UserPassword>();
    pg.register::<user::UserProfile>();
    pg.register::<user::UserStatusComponent>();
    pg.register::<user::AdminMark>();
    // Projects.
    pg.register::<project::ProjectName>();
    pg.register::<project::ProjectDescription>();
    pg.register::<project::ProjectOwnerId>();
    pg.register::<project::ProjectStatusComponent>();
    pg.register::<project::ProjectDates>();
    pg.register::<project::ProjectCoreRef>();
    pg.register::<project::ProjectMembership>();
    // Modules.
    pg.register::<module::ModuleName>();
    pg.register::<module::ModuleDescription>();
    pg.register::<module::ModuleProjectRef>();
    pg.register::<module::ModuleOrder>();
    // Tasks.
    pg.register::<task::TaskInfo>();
    pg.register::<task::TaskModuleRef>();
    pg.register::<task::TaskAssignees>();
    pg.register::<task::TaskLabels>();
    pg.register::<task::TaskAudit>();
    pg.register::<task::TaskParent>();
    pg.register::<task::TaskBlockedBy>();
    // Pages.
    pg.register::<page::PageInfo>();
    pg.register::<page::PageAudit>();
    // Media.
    pg.register::<media::MediaFileInfo>();
    pg.register::<media::TaskMediaLinkData>();
    // Labels.
    pg.register::<label::LabelInfo>();
    // Comments.
    pg.register::<comment::CommentInfo>();
    // Notifications.
    pg.register::<notification::NotificationInfo>();
    pg.register::<notification::NotificationRefs>();
    // Activity.
    pg.register::<activity::ActivityInfo>();
    pg.register::<activity::ActivityChanges>();
}

/// Skeleton entity: a single timestamp, used only to prove Arke↔Postgres round-trips.
#[derive(PgComponent, Debug, Clone)]
pub struct HeartbeatAt {
    /// ISO-8601 instant the heartbeat was written. Maps to a TEXT column.
    pub ts: String,
}
