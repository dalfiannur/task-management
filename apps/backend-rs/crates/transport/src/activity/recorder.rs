//! The shared `record` helper other services call after a successful mutation.
//! Best-effort: a failure is logged, never propagated to the triggering action.

use domain::activity::{ActivityAction, EntityType, FieldChange};
use persistence::Store;

use super::record::{create_activity, NewActivity};

fn now_iso() -> String {
    use time::format_description::well_known::Rfc3339;
    time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}

/// Record an audit-log entry. `changes` is a field diff (empty for create/delete).
/// Own actions are recorded (no self-suppression, unlike notifications).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn record(
    store: &Store,
    project_id: &str,
    actor_id: &str,
    entity_type: EntityType,
    entity_id: &str,
    action: ActivityAction,
    summary: String,
    changes: Vec<FieldChange>,
) {
    let res = create_activity(
        store,
        NewActivity {
            project_id,
            actor_id,
            entity_type,
            entity_id,
            action,
            summary: &summary,
            changes,
            created_at: &now_iso(),
            task_id: None,
        },
    )
    .await;
    if let Err(e) = res {
        tracing::warn!(error = %e, "failed to record activity");
    }
}

/// Record an entry about something on a task (a time entry), linked to that
/// task so the task's own feed shows it.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn record_on_task(
    store: &Store,
    project_id: &str,
    actor_id: &str,
    entity_type: EntityType,
    entity_id: &str,
    task_id: &str,
    action: ActivityAction,
    summary: String,
    changes: Vec<FieldChange>,
) {
    let res = create_activity(
        store,
        NewActivity {
            project_id,
            actor_id,
            entity_type,
            entity_id,
            action,
            summary: &summary,
            changes,
            created_at: &now_iso(),
            task_id: Some(task_id),
        },
    )
    .await;
    if let Err(e) = res {
        tracing::warn!(error = %e, "failed to record activity");
    }
}
