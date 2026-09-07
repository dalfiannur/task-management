//! Activity counts for a report window.
//!
//! Deliberately never loads an activity row. `activity/record.rs` records why:
//! hydrating a pid costs one existence query plus one per registered component
//! type — 22,028 round-trips and ~3.2s for 20 rows on a 672-row dev database. A
//! month of activity is far more than 20 rows, so this counts instead: nineteen
//! `COUNT`s against columns (`project_id`, `entity_type`, `action`,
//! `created_at`) that are all already indexed.

use std::collections::HashSet;

use domain::activity::{ActivityAction, ActivityInfo, EntityType};
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
/// `scope` is `None` for an admin (every project matches). Every value
/// interpolated below is either a `&'static str` from `as_str`, an `i64` that
/// parsed, or a `Window` boundary, which `Window::parse` restricts to digits
/// and fixed separators — the rule `sql.rs` exists to enforce.
pub(crate) async fn activity_summary(
    store: &Store,
    scope: Option<&HashSet<String>>,
    w: &Window,
) -> anyhow::Result<(Vec<pb::ActivitySummaryRow>, u32)> {
    let range = format!(
        "created_at >= '{}' AND created_at < '{}'",
        w.start(),
        w.end()
    );

    let base = match scope {
        None => range,
        Some(set) => {
            // Project ids are entity pids rendered as text; parse each so only
            // validated integers reach the predicate.
            let ids: Vec<String> = set
                .iter()
                .filter_map(|p| p.parse::<i64>().ok())
                .map(|n| format!("'{n}'"))
                .collect();
            // A member of no project matches nothing — return without querying
            // rather than emitting `IN ()`, which is a syntax error.
            if ids.is_empty() {
                return Ok((Vec::new(), 0));
            }
            format!("{range} AND project_id IN ({})", ids.join(", "))
        }
    };

    let total = store.count::<ActivityInfo>(Some(&base)).await?;
    if total == 0 {
        return Ok((Vec::new(), 0));
    }

    let mut rows = Vec::new();
    for entity in ENTITIES {
        for action in ACTIONS {
            let pred = format!(
                "{base} AND entity_type = '{}' AND action = '{}'",
                entity.as_str(),
                action.as_str()
            );
            let count = store.count::<ActivityInfo>(Some(&pred)).await?;
            if count > 0 {
                rows.push(pb::ActivitySummaryRow {
                    entity_type: entity.to_proto(),
                    action: action.to_proto(),
                    count,
                });
            }
        }
    }
    Ok((rows, total))
}
