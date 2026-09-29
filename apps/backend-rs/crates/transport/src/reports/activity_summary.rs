//! Activity counts for a report window.
//!
//! Deliberately never loads an activity row: a month of activity can be large,
//! so this counts instead — one `COUNT(*)` for the total and one grouped count
//! per (entity type, action), over indexed columns.

use std::collections::HashSet;

use std::collections::HashMap;

use domain::activity::{ActivityAction, EntityType};
use persistence::Store;

use super::window::Window;
use crate::sedjiwa::tasks::reports::v1 as pb;

/// `activity_total` below is an independent `COUNT(*)` over every activity
/// row in scope, not a sum of what `ENTITIES × ACTIONS` produces — so if a
/// seventh `EntityType` or a fourth `ActivityAction` is ever added without
/// updating the arrays below, `activity_total` silently stops equalling the
/// sum of the rows the UI prints beneath it ("{total} recorded changes"),
/// and nothing fails loudly. `assert_entity_exhaustive`/
/// `assert_action_exhaustive` exist only to make that impossible to miss:
/// their `match`es have no wildcard arm, so adding a variant to either enum
/// without adding an arm here is a compile error, and the person fixing that
/// error is looking straight at the array they also need to extend.
const fn assert_entity_exhaustive(e: EntityType) -> EntityType {
    match e {
        EntityType::Task
        | EntityType::Module
        | EntityType::Membership
        | EntityType::Ownership
        | EntityType::Page
        | EntityType::Media => e,
    }
}

const fn assert_action_exhaustive(a: ActivityAction) -> ActivityAction {
    match a {
        ActivityAction::Created | ActivityAction::Updated | ActivityAction::Deleted => a,
    }
}

const ENTITIES: [EntityType; 6] = [
    assert_entity_exhaustive(EntityType::Task),
    assert_entity_exhaustive(EntityType::Module),
    assert_entity_exhaustive(EntityType::Membership),
    assert_entity_exhaustive(EntityType::Ownership),
    assert_entity_exhaustive(EntityType::Page),
    assert_entity_exhaustive(EntityType::Media),
];
const ACTIONS: [ActivityAction; 3] = [
    assert_action_exhaustive(ActivityAction::Created),
    assert_action_exhaustive(ActivityAction::Updated),
    assert_action_exhaustive(ActivityAction::Deleted),
];

/// `(rows, total)`. Rows with a count of zero are dropped — a report listing
/// "Page deleted 0×" is noise.
///
/// `scope` is `None` for an admin (every project matches).
pub(crate) async fn activity_summary(
    store: &Store,
    scope: Option<&HashSet<String>>,
    w: &Window,
) -> anyhow::Result<(Vec<pb::ActivitySummaryRow>, u32)> {
    // Project ids are entity pids rendered as text; only numeric ones can name
    // a project. `None` binds as NULL, which the filter reads as "every row".
    let ids: Option<Vec<String>> = match scope {
        None => None,
        Some(set) => {
            let ids: Vec<String> = set
                .iter()
                .filter_map(|p| p.parse::<i64>().ok())
                .map(|n| n.to_string())
                .collect();
            // A member of no project matches nothing.
            if ids.is_empty() {
                return Ok((Vec::new(), 0));
            }
            Some(ids)
        }
    };
    let (start, end) = (w.start(), w.end());
    const IN_SCOPE: &str = "created_at >= $1 AND created_at < $2 \
                            AND ($3::text[] IS NULL OR project_id = ANY($3))";

    let total: i64 = sqlx::query_scalar(&format!(
        "SELECT count(*) FROM cmp_activityinfo WHERE {IN_SCOPE}"
    ))
    .bind(start)
    .bind(end)
    .bind(&ids)
    .fetch_one(store.pool())
    .await?;
    if total == 0 {
        return Ok((Vec::new(), 0));
    }

    let counts: HashMap<(String, String), i64> = sqlx::query_as::<_, (String, String, i64)>(&format!(
        "SELECT entity_type, action, count(*) FROM cmp_activityinfo WHERE {IN_SCOPE} \
         GROUP BY entity_type, action"
    ))
    .bind(start)
    .bind(end)
    .bind(&ids)
    .fetch_all(store.pool())
    .await?
    .into_iter()
    .map(|(e, a, n)| ((e, a), n))
    .collect();

    // Rows in the fixed ENTITIES × ACTIONS order, zero counts left out.
    let mut rows = Vec::new();
    for entity in ENTITIES {
        for action in ACTIONS {
            let key = (entity.as_str().to_string(), action.as_str().to_string());
            let count = counts.get(&key).copied().unwrap_or(0);
            if count > 0 {
                rows.push(pb::ActivitySummaryRow {
                    entity_type: entity.to_proto(),
                    action: action.to_proto(),
                    count: count as u32,
                });
            }
        }
    }
    Ok((rows, total.max(0) as u32))
}
