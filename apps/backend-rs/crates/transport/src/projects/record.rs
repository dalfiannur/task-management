//! Project rows ↔ the `Project` proto, plus every read and write the projects
//! flows make.
//!
//! Plain sqlx over the component tables of `persistence/src/schema.sql` (see
//! `persistence::entity`). A project is one entity carrying `cmp_projectname`,
//! `cmp_projectownerid` and `cmp_projectstatuscomponent`, optionally
//! `cmp_projectdescription` and `cmp_projectdates`. A membership is its own
//! entity: one `cmp_projectmembership` row naming a project and a user by their
//! pid strings.

use domain::project::ProjectStatus;
use persistence::{entity, Store};

use super::audit;
use sqlx::postgres::PgRow;
use sqlx::{PgConnection, Row};

use crate::sedjiwa::tasks::project::v1 as pb;

#[derive(Debug, Clone)]
pub(crate) struct ProjectRecord {
    pub pid: i64,
    pub name: String,
    pub description: Option<String>,
    pub status: ProjectStatus,
    pub owner_id: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub is_template: bool,
}

/// Name, owner and status are what make an entity a project — the inner joins.
const SELECT_PROJECT: &str = "\
    SELECT n.pid, n.value AS name, d.value AS description, s.value AS status, \
           o.value AS owner_id, dt.start_date, dt.end_date, \
           (tm.pid IS NOT NULL) AS is_template, \
           del.deleted_at, del.deleted_by \
    FROM cmp_projectname n \
    JOIN cmp_projectownerid o ON o.pid = n.pid \
    JOIN cmp_projectstatuscomponent s ON s.pid = n.pid \
    LEFT JOIN cmp_projectdescription d ON d.pid = n.pid \
    LEFT JOIN cmp_projectdates dt ON dt.pid = n.pid \
    LEFT JOIN cmp_projecttemplatemark tm ON tm.pid = n.pid \
    LEFT JOIN cmp_projectdeleted del ON del.pid = n.pid";

/// `None` for a stored status this build does not know.
fn read_project(row: &PgRow) -> sqlx::Result<Option<ProjectRecord>> {
    let status: String = row.try_get("status")?;
    let Some(status) = ProjectStatus::parse(&status) else {
        return Ok(None);
    };
    Ok(Some(ProjectRecord {
        pid: row.try_get("pid")?,
        name: row.try_get("name")?,
        description: row.try_get("description")?,
        status,
        owner_id: row.try_get("owner_id")?,
        start_date: row.try_get("start_date")?,
        end_date: row.try_get("end_date")?,
        is_template: row.try_get("is_template")?,
    }))
}

pub(crate) fn to_proto(p: &ProjectRecord) -> pb::Project {
    pb::Project {
        id: p.pid.to_string(),
        name: p.name.clone(),
        description: p.description.clone(),
        status: p.status.to_proto(),
        owner_id: p.owner_id.clone(),
        start_date: p.start_date.clone(),
        end_date: p.end_date.clone(),
        tasks: None,
        is_template: p.is_template,
    }
}

// ── Reads ────────────────────────────────────────────────────────────────────

pub(crate) async fn load_project(store: &Store, pid: i64) -> anyhow::Result<Option<ProjectRecord>> {
    let row = sqlx::query(&format!("{SELECT_PROJECT} WHERE n.pid = $1 AND del.pid IS NULL"))
        .bind(pid)
        .fetch_optional(store.pool())
        .await?;
    Ok(match row {
        Some(row) => read_project(&row)?,
        None => None,
    })
}

/// Every project, oldest first.
pub(crate) async fn load_all_projects(store: &Store) -> anyhow::Result<Vec<ProjectRecord>> {
    let rows = sqlx::query(&format!("{SELECT_PROJECT} WHERE del.pid IS NULL ORDER BY n.pid"))
        .fetch_all(store.pool())
        .await?;
    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        out.extend(read_project(row)?);
    }
    Ok(out)
}

/// True if `user_id` is a member of `project_id`.
pub(crate) async fn is_member(
    store: &Store,
    project_id: &str,
    user_id: &str,
) -> anyhow::Result<bool> {
    let mut conn = store.pool().acquire().await?;
    Ok(is_member_on(&mut conn, project_id, user_id).await?)
}

async fn is_member_on(
    conn: &mut PgConnection,
    project_id: &str,
    user_id: &str,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM cmp_projectmembership WHERE project_id = $1 AND user_id = $2)",
    )
    .bind(project_id)
    .bind(user_id)
    .fetch_one(conn)
    .await
}

/// Live project ids `user_id` is a member of (trashed projects left out).
pub(crate) async fn member_project_ids(
    store: &Store,
    user_id: &str,
) -> anyhow::Result<Vec<String>> {
    Ok(sqlx::query_scalar(
        "SELECT m.project_id FROM cmp_projectmembership m \
         WHERE m.user_id = $1 \
           AND NOT EXISTS (SELECT 1 FROM cmp_projectdeleted d WHERE d.pid::text = m.project_id) \
         ORDER BY m.pid",
    )
    .bind(user_id)
    .fetch_all(store.pool())
    .await?)
}

/// Member `user_id`s of `project_id` (sorted byte-wise, deduped).
pub(crate) async fn project_member_ids(
    store: &Store,
    project_id: &str,
) -> anyhow::Result<Vec<String>> {
    Ok(sqlx::query_scalar(
        "SELECT DISTINCT user_id COLLATE \"C\" FROM cmp_projectmembership \
         WHERE project_id = $1 ORDER BY 1",
    )
    .bind(project_id)
    .fetch_all(store.pool())
    .await?)
}

/// True if `user_id` names an existing user (has a `cmp_userphone` row).
pub(crate) async fn user_exists(store: &Store, user_id: &str) -> anyhow::Result<bool> {
    let Ok(pid) = user_id.parse::<i64>() else {
        return Ok(false);
    };
    Ok(
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM cmp_userphone WHERE pid = $1)")
            .bind(pid)
            .fetch_one(store.pool())
            .await?,
    )
}

// ── Writes ───────────────────────────────────────────────────────────────────

/// Insert one membership entity.
async fn insert_member(conn: &mut PgConnection, project_id: &str, user_id: &str) -> sqlx::Result<()> {
    let pid = entity::new_pid(conn).await?;
    sqlx::query("INSERT INTO cmp_projectmembership (pid, project_id, user_id) VALUES ($1, $2, $3)")
        .bind(pid)
        .bind(project_id)
        .bind(user_id)
        .execute(conn)
        .await?;
    Ok(())
}

/// Create an Active project with its owner as a member — and `creator` too
/// when it is someone else — in one transaction. Returns the project's `pid`.
pub(crate) async fn create_project(
    store: &Store,
    name: &str,
    description: Option<&str>,
    owner_id: &str,
    creator_id: &str,
) -> anyhow::Result<i64> {
    let mut tx = store.pool().begin().await?;
    let pid = create_project_on(&mut tx, name, description, owner_id, creator_id).await?;
    let project_id = pid.to_string();
    crate::work::status_record::ensure_defaults(&mut tx, &project_id).await?;
    tx.commit().await?;
    Ok(pid)
}

/// [`create_project`] inside the caller's transaction, without the default
/// statuses (a copy brings its own).
pub(crate) async fn create_project_on(
    tx: &mut PgConnection,
    name: &str,
    description: Option<&str>,
    owner_id: &str,
    creator_id: &str,
) -> sqlx::Result<i64> {
    let pid = entity::new_pid(&mut *tx).await?;
    sqlx::query("INSERT INTO cmp_projectname (pid, value) VALUES ($1, $2)")
        .bind(pid)
        .bind(name)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO cmp_projectownerid (pid, value) VALUES ($1, $2)")
        .bind(pid)
        .bind(owner_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO cmp_projectstatuscomponent (pid, value) VALUES ($1, $2)")
        .bind(pid)
        .bind(ProjectStatus::Active.as_str())
        .execute(&mut *tx)
        .await?;
    if let Some(desc) = description {
        sqlx::query("INSERT INTO cmp_projectdescription (pid, value) VALUES ($1, $2)")
            .bind(pid)
            .bind(desc)
            .execute(&mut *tx)
            .await?;
    }
    let project_id = pid.to_string();
    insert_member(&mut *tx, &project_id, owner_id).await?;
    if creator_id != owner_id {
        insert_member(&mut *tx, &project_id, creator_id).await?;
    }
    Ok(pid)
}

/// Mark (`true`) or unmark `pid` as a template.
pub(crate) async fn set_template(store: &Store, pid: i64, on: bool) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    if !entity::touch(&mut tx, pid).await? {
        return Ok(());
    }
    let sql = if on {
        "INSERT INTO cmp_projecttemplatemark (pid) VALUES ($1) ON CONFLICT DO NOTHING"
    } else {
        "DELETE FROM cmp_projecttemplatemark WHERE pid = $1"
    };
    sqlx::query(sql).bind(pid).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn set_status(store: &Store, pid: i64, status: ProjectStatus) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    if entity::touch(&mut tx, pid).await? {
        sqlx::query("UPDATE cmp_projectstatuscomponent SET value = $2 WHERE pid = $1")
            .bind(pid)
            .bind(status.as_str())
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
    }
    Ok(())
}

/// Hand the project to `new_owner`, making them a member if they are not one.
pub(crate) async fn transfer_owner(store: &Store, pid: i64, new_owner: &str) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    if !entity::touch(&mut tx, pid).await? {
        return Ok(());
    }
    sqlx::query("UPDATE cmp_projectownerid SET value = $2 WHERE pid = $1")
        .bind(pid)
        .bind(new_owner)
        .execute(&mut *tx)
        .await?;
    let project_id = pid.to_string();
    if !is_member_on(&mut tx, &project_id, new_owner).await? {
        insert_member(&mut tx, &project_id, new_owner).await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Add `user_id` to the project unless already a member. Returns whether a
/// membership was created.
pub(crate) async fn add_member(store: &Store, project_id: &str, user_id: &str) -> anyhow::Result<bool> {
    let mut tx = store.pool().begin().await?;
    if is_member_on(&mut tx, project_id, user_id).await? {
        return Ok(false);
    }
    insert_member(&mut tx, project_id, user_id).await?;
    tx.commit().await?;
    Ok(true)
}

/// Remove every membership of `user_id` in the project. Returns whether there
/// was one.
pub(crate) async fn remove_member(
    store: &Store,
    project_id: &str,
    user_id: &str,
) -> anyhow::Result<bool> {
    let removed = sqlx::query(
        "DELETE FROM arke_entities WHERE pid IN \
         (SELECT pid FROM cmp_projectmembership WHERE project_id = $1 AND user_id = $2)",
    )
    .bind(project_id)
    .bind(user_id)
    .execute(store.pool())
    .await?;
    Ok(removed.rows_affected() > 0)
}

// ── Trash ────────────────────────────────────────────────────────────────────
//
// `load_project`, `load_all_projects` and `member_project_ids` see live
// projects only, so every read built on them (dashboards, reports, search,
// workload, My tasks) drops a trashed project; `require_live` makes the
// per-request member checks answer `not_found` for it, admins included.

/// Every live project id (trashed ones left out) — the admin's scope.
pub(crate) async fn live_project_ids(store: &Store) -> anyhow::Result<Vec<String>> {
    Ok(load_all_projects(store).await?.iter().map(|p| p.pid.to_string()).collect())
}

/// Whether `project_id` is in the trash.
pub(crate) async fn is_trashed(store: &Store, project_id: &str) -> anyhow::Result<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM cmp_projectdeleted WHERE pid::text = $1)",
    )
    .bind(project_id)
    .fetch_one(store.pool())
    .await?)
}

/// `not_found` for a trashed project: it does not exist for anyone until an
/// admin restores it.
pub(crate) async fn require_live(
    store: &Store,
    project_id: &str,
) -> Result<(), connectrpc_axum::ConnectError> {
    match is_trashed(store, project_id).await {
        Ok(false) => Ok(()),
        Ok(true) => Err(connectrpc_axum::ConnectError::new_not_found("project not found")),
        Err(e) => Err(crate::work::internal(e)),
    }
}

/// Move a project to the trash. Nothing else changes, so a restore brings
/// everything back exactly.
pub(crate) async fn trash_project(store: &Store, pid: i64, by: &str, now: &str) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    if entity::touch(&mut tx, pid).await? {
        let trashed = sqlx::query(
            "INSERT INTO cmp_projectdeleted (pid, deleted_at, deleted_by) VALUES ($1, $2, $3) \
             ON CONFLICT (pid) DO NOTHING",
        )
        .bind(pid)
        .bind(now)
        .bind(by)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if trashed > 0 {
            audit_project(&mut tx, audit::PROJECT_TRASHED, pid, by, now).await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn restore_project(store: &Store, pid: i64, by: &str, now: &str) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    if entity::touch(&mut tx, pid).await? {
        let restored = sqlx::query("DELETE FROM cmp_projectdeleted WHERE pid = $1")
            .bind(pid)
            .execute(&mut *tx)
            .await?
            .rows_affected();
        if restored > 0 {
            audit_project(&mut tx, audit::PROJECT_RESTORED, pid, by, now).await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

/// Audit a trash or restore of `pid` under its current name.
async fn audit_project(
    conn: &mut sqlx::PgConnection,
    action: &str,
    pid: i64,
    by: &str,
    now: &str,
) -> anyhow::Result<()> {
    let name: String = sqlx::query_scalar("SELECT value FROM cmp_projectname WHERE pid = $1")
        .bind(pid)
        .fetch_optional(&mut *conn)
        .await?
        .unwrap_or_default();
    audit::record_audit(
        conn,
        audit::NewAudit {
            actor_id: by,
            action,
            subject_id: &pid.to_string(),
            subject_name: &name,
            contents: &super::purge::Contents::default(),
            projects: 1,
            now,
        },
    )
    .await?;
    Ok(())
}

/// A trashed project with when and by whom.
#[derive(Debug, Clone)]
pub(crate) struct TrashedProject {
    pub project: ProjectRecord,
    pub deleted_at: String,
    pub deleted_by: String,
}

/// Every trashed project, most recently deleted first.
pub(crate) async fn trashed_projects(store: &Store) -> anyhow::Result<Vec<TrashedProject>> {
    let rows = sqlx::query(&format!(
        "{SELECT_PROJECT} WHERE del.pid IS NOT NULL ORDER BY del.deleted_at DESC, n.pid DESC"
    ))
    .fetch_all(store.pool())
    .await?;
    // When and by whom come from the same row as the project: a second query
    // per project would race a concurrent restore or purge (no row → 500).
    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let Some(project) = read_project(row)? else { continue };
        out.push(TrashedProject {
            project,
            deleted_at: row.try_get("deleted_at")?,
            deleted_by: row.try_get("deleted_by")?,
        });
    }
    Ok(out)
}

/// A trashed project for the trash flows (a live one reads as `None`).
pub(crate) async fn load_trashed(store: &Store, pid: i64) -> anyhow::Result<Option<ProjectRecord>> {
    let row = sqlx::query(&format!("{SELECT_PROJECT} WHERE n.pid = $1 AND del.pid IS NOT NULL"))
        .bind(pid)
        .fetch_optional(store.pool())
        .await?;
    Ok(match row {
        Some(row) => read_project(&row)?,
        None => None,
    })
}

