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
        },
    )
    .await;
    if let Err(e) = res {
        tracing::warn!(error = %e, "failed to record activity");
    }
}
