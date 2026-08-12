//! Activity records ↔ proto + store lookups.

use std::collections::HashSet;

use arke::{Entity, World};
use domain::activity::{ActivityAction, ActivityChanges, ActivityInfo, EntityType, FieldChange};
use persistence::{PgTable, Store};

use crate::sedjiwa::tasks::activity::v1 as pb;

/// True when `v` is safe to inline into a `predicate` as a quoted string.
///
/// `predicate` is interpolated as raw SQL and never bound, so the codebase's rule
/// is to inline only validated values (`load_project` inlines a parsed i64). Ids
/// here cannot all be integers — OWNERSHIP rows carry a user id such as
/// `usrB1786485885569204744` — so this validates the charset instead of escaping
/// quotes: a value containing `'` is rejected outright rather than escaped, so no
/// quote can reach the statement no matter what `standard_conforming_strings` is
/// set to. Every id stored in cmp_activityinfo (entity_id, actor_id, project_id)
/// matches this charset; anything outside it cannot match a stored id anyway, so
/// callers filter to empty rather than erroring.
fn safe_sql_id(v: &str) -> bool {
    !v.is_empty()
        && v.len() <= 64
        && v.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

#[derive(Debug, Clone)]
pub(crate) struct ActivityRecord {
    pub pid: i64,
    pub project_id: String,
    pub actor_id: String,
    pub entity_type: EntityType,
    pub entity_id: String,
    pub action: ActivityAction,
    pub summary: String,
    pub changes: Vec<FieldChange>,
    pub created_at: String,
}

pub(crate) fn read_activity(world: &World, e: Entity, pid: i64) -> Option<ActivityRecord> {
    let info = world.get::<ActivityInfo>(e)?;
    Some(ActivityRecord {
        pid,
        project_id: info.project_id.clone(),
        actor_id: info.actor_id.clone(),
        entity_type: EntityType::parse(&info.entity_type)?,
        entity_id: info.entity_id.clone(),
        action: ActivityAction::parse(&info.action)?,
        summary: info.summary.clone(),
        changes: world
            .get::<ActivityChanges>(e)
            .map(|c| c.changes.clone())
            .unwrap_or_default(),
        created_at: info.created_at.clone(),
    })
}

pub(crate) fn to_proto(a: &ActivityRecord) -> pb::Activity {
    pb::Activity {
        id: a.pid.to_string(),
        project_id: a.project_id.clone(),
        actor_id: a.actor_id.clone(),
        entity_type: a.entity_type.to_proto(),
        entity_id: a.entity_id.clone(),
        action: a.action.to_proto(),
        summary: a.summary.clone(),
        changes: a
            .changes
            .iter()
            .map(|c| pb::FieldChange {
                field: c.field.clone(),
                from: c.from.clone(),
                to: c.to.clone(),
            })
            .collect(),
        created_at: a.created_at.clone(),
    }
}

fn desc(mut v: Vec<ActivityRecord>) -> Vec<ActivityRecord> {
    v.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.pid.cmp(&a.pid)));
    v
}

pub(crate) async fn activity_for_project(
    store: &Store,
    project_id: &str,
) -> anyhow::Result<Vec<ActivityRecord>> {
    // Filter in SQL, not in Rust. `query(None, ..)` selects every pid in
    // cmp_activityinfo and then hydrates each one individually — and hydrating a
    // pid costs one existence query PLUS one query per registered component type
    // (32 of them). The cost therefore scaled with the whole table and with the
    // size of the domain, not with this project. Measured against a 672-row dev
    // database: 22,028 round-trips and ~3.2s to return 20 rows.
    //
    // idx_cmp_activityinfo_project_id already exists; it was simply never
    // reachable while the predicate was None.
    //
    // `predicate` is interpolated as raw SQL, never bound, so only a validated
    // integer may go in — same rule as `load_project`. A project id is an entity
    // pid rendered as text; a non-numeric one matched no row under the old Rust
    // comparison either, so returning empty preserves that behaviour.
    let Ok(pid) = project_id.parse::<i64>() else {
        return Ok(Vec::new());
    };
    let pred = format!("project_id = '{pid}'");
    let v = store
        .query::<ActivityInfo, ActivityRecord>(Some(&pred), |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| read_activity(world, *e, *pid))
                .collect()
        })
        .await?;
    Ok(desc(v))
}

pub(crate) async fn activity_for_entity(
    store: &Store,
    entity_type: EntityType,
    entity_id: &str,
) -> anyhow::Result<Vec<ActivityRecord>> {
    // Same reason as `activity_for_project`: the filter belongs in SQL, or every
    // activity row in the database gets hydrated so that a handful can be kept.
    // `entity_type` comes from our own enum, so its text is a fixed vocabulary
    // ("task", "module", …) and never caller-supplied; `entity_id` IS caller
    // supplied and so must clear `safe_sql_id`.
    if !safe_sql_id(entity_id) {
        return Ok(Vec::new());
    }
    let pred = format!(
        "entity_type = '{}' AND entity_id = '{}'",
        entity_type.as_str(),
        entity_id
    );
    let v = store
        .query::<ActivityInfo, ActivityRecord>(Some(&pred), |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| read_activity(world, *e, *pid))
                .collect()
        })
        .await?;
    Ok(desc(v))
}

/// One page of recent activity across `projects` (or all projects if `None`, for
/// admins), newest first, plus the unpaged total.
///
/// Paged in SQL rather than in Rust. The other two feeds are naturally bounded —
/// by one project, or by one entity — but this one is not: an admin matches every
/// row in the table, so no predicate can shrink it and hydrating the full match
/// set to then keep 30 rows grows without limit as the audit log does. Selecting
/// the page in a subquery caps hydration at `page_size` rows regardless of table
/// size; `total` comes from a COUNT that hydrates nothing.
pub(crate) async fn activity_recent_page(
    store: &Store,
    projects: Option<HashSet<String>>,
    page: u32,
    page_size: u32,
) -> anyhow::Result<(Vec<ActivityRecord>, u32)> {
    // Project ids are entity pids rendered as text; parse each so only validated
    // integers reach the predicate. A caller-supplied id that is not numeric
    // matched nothing under the old Rust `contains` either.
    let filter = match projects {
        None => None, // admin: every row matches
        Some(set) => {
            let ids: Vec<String> = set
                .iter()
                .filter_map(|p| p.parse::<i64>().ok())
                .map(|n| format!("'{n}'"))
                .collect();
            // A member of no projects matches nothing — return without querying
            // rather than emitting `IN ()`, which is a syntax error.
            if ids.is_empty() {
                return Ok((Vec::new(), 0));
            }
            Some(format!("project_id IN ({})", ids.join(", ")))
        }
    };

    let total = store
        .count::<ActivityInfo>(filter.as_deref())
        .await?;

    let size = if page_size == 0 { 30 } else { page_size };
    let start = (page.max(1) - 1).saturating_mul(size);
    let where_c = filter
        .as_ref()
        .map(|f| format!("WHERE {f} "))
        .unwrap_or_default();
    // COLLATE "C" so the database orders these RFC3339 strings byte-wise, exactly
    // as `desc()` does in Rust — the default collation can order punctuation
    // differently and would then hand back a different page than the one the
    // caller's ordering implies. The outer query re-sorts by pid, so `desc()`
    // still establishes the final order of the rows this selects.
    let pred = format!(
        "pid IN (SELECT pid FROM {table} {where_c}ORDER BY created_at COLLATE \"C\" DESC, pid DESC LIMIT {size} OFFSET {start})",
        table = <ActivityInfo as PgTable>::TABLE,
    );
    let v = store
        .query::<ActivityInfo, ActivityRecord>(Some(&pred), |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| read_activity(world, *e, *pid))
                .collect()
        })
        .await?;
    Ok((desc(v), total))
}
