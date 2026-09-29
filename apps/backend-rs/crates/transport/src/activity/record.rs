//! Activity rows ↔ proto, plus the reads and the one write the activity flows
//! make.
//!
//! Plain sqlx over the component tables arke-postgres created (see
//! `persistence::entity`). An entry is one entity carrying `cmp_activityinfo`
//! and, optionally, `cmp_activitychanges` — a JSONB array of
//! `{"field", "from", "to"}` objects (`from`/`to` may be null), the shape
//! arke's serializer wrote. It crosses the wire as three parallel `text[]`s so
//! sqlx needs no JSON support.

use std::collections::HashSet;

use domain::activity::{ActivityAction, EntityType, FieldChange};
use persistence::{entity, Store};
use sqlx::postgres::PgRow;
use sqlx::Row;

use crate::sedjiwa::tasks::activity::v1 as pb;

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

const SELECT_ACTIVITY: &str = "\
    SELECT i.pid, i.project_id, i.actor_id, i.entity_type, i.entity_id, i.action, i.summary, \
           i.created_at, \
           ARRAY(SELECT e.c->>'field' FROM jsonb_array_elements(ch.changes) WITH ORDINALITY AS e(c, n) ORDER BY e.n) AS ch_field, \
           ARRAY(SELECT e.c->>'from' FROM jsonb_array_elements(ch.changes) WITH ORDINALITY AS e(c, n) ORDER BY e.n) AS ch_from, \
           ARRAY(SELECT e.c->>'to' FROM jsonb_array_elements(ch.changes) WITH ORDINALITY AS e(c, n) ORDER BY e.n) AS ch_to \
    FROM cmp_activityinfo i LEFT JOIN cmp_activitychanges ch ON ch.pid = i.pid";

/// Newest first, byte-wise on the RFC3339 timestamp.
const NEWEST_FIRST: &str = "ORDER BY i.created_at COLLATE \"C\" DESC, i.pid DESC";

/// `None` for a stored entity type or action this build does not know.
fn read_activity(row: &PgRow) -> sqlx::Result<Option<ActivityRecord>> {
    let entity_type: String = row.try_get("entity_type")?;
    let action: String = row.try_get("action")?;
    let (Some(entity_type), Some(action)) =
        (EntityType::parse(&entity_type), ActivityAction::parse(&action))
    else {
        return Ok(None);
    };
    let fields: Vec<Option<String>> = row.try_get("ch_field")?;
    let froms: Vec<Option<String>> = row.try_get("ch_from")?;
    let tos: Vec<Option<String>> = row.try_get("ch_to")?;
    let changes = fields
        .into_iter()
        .zip(froms)
        .zip(tos)
        .map(|((field, from), to)| FieldChange {
            field: field.unwrap_or_default(),
            from,
            to,
        })
        .collect();
    Ok(Some(ActivityRecord {
        pid: row.try_get("pid")?,
        project_id: row.try_get("project_id")?,
        actor_id: row.try_get("actor_id")?,
        entity_type,
        entity_id: row.try_get("entity_id")?,
        action,
        summary: row.try_get("summary")?,
        changes,
        created_at: row.try_get("created_at")?,
    }))
}

fn read_all(rows: &[PgRow]) -> sqlx::Result<Vec<ActivityRecord>> {
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.extend(read_activity(row)?);
    }
    Ok(out)
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

// ── Reads ────────────────────────────────────────────────────────────────────

/// A project's activity, newest first. Project ids are pids rendered as text;
/// a non-numeric one names no project and returns nothing.
pub(crate) async fn activity_for_project(
    store: &Store,
    project_id: &str,
) -> anyhow::Result<Vec<ActivityRecord>> {
    let Ok(pid) = project_id.parse::<i64>() else {
        return Ok(Vec::new());
    };
    let rows = sqlx::query(&format!(
        "{SELECT_ACTIVITY} WHERE i.project_id = $1 {NEWEST_FIRST}"
    ))
    .bind(pid.to_string())
    .fetch_all(store.pool())
    .await?;
    Ok(read_all(&rows)?)
}

/// One entity's activity, newest first.
pub(crate) async fn activity_for_entity(
    store: &Store,
    entity_type: EntityType,
    entity_id: &str,
) -> anyhow::Result<Vec<ActivityRecord>> {
    let rows = sqlx::query(&format!(
        "{SELECT_ACTIVITY} WHERE i.entity_type = $1 AND i.entity_id = $2 {NEWEST_FIRST}"
    ))
    .bind(entity_type.as_str())
    .bind(entity_id)
    .fetch_all(store.pool())
    .await?;
    Ok(read_all(&rows)?)
}

/// One page of recent activity across `projects` (or all projects if `None`, for
/// admins), newest first, plus the unpaged total.
///
/// Paged in SQL: an admin matches every row in the table, so the page is the
/// only bound on how much is read.
pub(crate) async fn activity_recent_page(
    store: &Store,
    projects: Option<HashSet<String>>,
    page: u32,
    page_size: u32,
) -> anyhow::Result<(Vec<ActivityRecord>, u32)> {
    // Project ids are entity pids rendered as text; only numeric ones can name
    // a project. `None` binds as NULL, which the filter reads as "every row".
    let ids: Option<Vec<String>> = match projects {
        None => None,
        Some(set) => {
            let ids: Vec<String> = set
                .iter()
                .filter_map(|p| p.parse::<i64>().ok())
                .map(|n| n.to_string())
                .collect();
            // A member of no projects matches nothing.
            if ids.is_empty() {
                return Ok((Vec::new(), 0));
            }
            Some(ids)
        }
    };

    let total: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM cmp_activityinfo i WHERE $1::text[] IS NULL OR i.project_id = ANY($1)",
    )
    .bind(&ids)
    .fetch_one(store.pool())
    .await?;

    let size = if page_size == 0 { 30 } else { page_size };
    let start = i64::from(page.max(1) - 1) * i64::from(size);
    let rows = sqlx::query(&format!(
        "{SELECT_ACTIVITY} WHERE $1::text[] IS NULL OR i.project_id = ANY($1) \
         {NEWEST_FIRST} LIMIT $2 OFFSET $3"
    ))
    .bind(&ids)
    .bind(i64::from(size))
    .bind(start)
    .fetch_all(store.pool())
    .await?;
    Ok((read_all(&rows)?, total.max(0) as u32))
}

// ── Write ────────────────────────────────────────────────────────────────────

pub(crate) struct NewActivity<'a> {
    pub project_id: &'a str,
    pub actor_id: &'a str,
    pub entity_type: EntityType,
    pub entity_id: &'a str,
    pub action: ActivityAction,
    pub summary: &'a str,
    pub changes: Vec<FieldChange>,
    pub created_at: &'a str,
}

/// An entry and its changes row, in one transaction.
pub(crate) async fn create_activity(store: &Store, a: NewActivity<'_>) -> anyhow::Result<i64> {
    let mut fields = Vec::with_capacity(a.changes.len());
    let mut froms = Vec::with_capacity(a.changes.len());
    let mut tos = Vec::with_capacity(a.changes.len());
    for c in a.changes {
        fields.push(c.field);
        froms.push(c.from);
        tos.push(c.to);
    }
    let mut tx = store.pool().begin().await?;
    let pid = entity::new_pid(&mut tx).await?;
    sqlx::query(
        "INSERT INTO cmp_activityinfo \
         (pid, project_id, actor_id, entity_type, entity_id, action, summary, created_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(pid)
    .bind(a.project_id)
    .bind(a.actor_id)
    .bind(a.entity_type.as_str())
    .bind(a.entity_id)
    .bind(a.action.as_str())
    .bind(a.summary)
    .bind(a.created_at)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO cmp_activitychanges (pid, changes) VALUES ($1, COALESCE( \
             (SELECT jsonb_agg(jsonb_build_object('field', u.f, 'from', u.fr, 'to', u.t) ORDER BY u.n) \
              FROM unnest($2::text[], $3::text[], $4::text[]) WITH ORDINALITY AS u(f, fr, t, n)), \
             '[]'::jsonb))",
    )
    .bind(pid)
    .bind(fields)
    .bind(froms)
    .bind(tos)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(pid)
}
