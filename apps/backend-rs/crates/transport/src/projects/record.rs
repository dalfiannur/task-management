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
}

/// Name, owner and status are what make an entity a project — the inner joins.
const SELECT_PROJECT: &str = "\
    SELECT n.pid, n.value AS name, d.value AS description, s.value AS status, \
           o.value AS owner_id, dt.start_date, dt.end_date \
    FROM cmp_projectname n \
    JOIN cmp_projectownerid o ON o.pid = n.pid \
    JOIN cmp_projectstatuscomponent s ON s.pid = n.pid \
    LEFT JOIN cmp_projectdescription d ON d.pid = n.pid \
    LEFT JOIN cmp_projectdates dt ON dt.pid = n.pid";

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
    }
}

// ── Reads ────────────────────────────────────────────────────────────────────

pub(crate) async fn load_project(store: &Store, pid: i64) -> anyhow::Result<Option<ProjectRecord>> {
    let row = sqlx::query(&format!("{SELECT_PROJECT} WHERE n.pid = $1"))
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
    let rows = sqlx::query(&format!("{SELECT_PROJECT} ORDER BY n.pid"))
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

/// Project ids `user_id` is a member of.
pub(crate) async fn member_project_ids(
    store: &Store,
    user_id: &str,
) -> anyhow::Result<Vec<String>> {
    Ok(sqlx::query_scalar(
        "SELECT project_id FROM cmp_projectmembership WHERE user_id = $1 ORDER BY pid",
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
    let pid = entity::new_pid(&mut tx).await?;
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
    insert_member(&mut tx, &project_id, owner_id).await?;
    if creator_id != owner_id {
        insert_member(&mut tx, &project_id, creator_id).await?;
    }
    tx.commit().await?;
    Ok(pid)
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

/// Delete the project entity and every membership of it. Modules, tasks and the
/// rest are the other flows' cascade, as before.
pub(crate) async fn delete_project(store: &Store, pid: i64) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    sqlx::query(
        "DELETE FROM arke_entities WHERE pid IN \
         (SELECT pid FROM cmp_projectmembership WHERE project_id = $1)",
    )
    .bind(pid.to_string())
    .execute(&mut *tx)
    .await?;
    entity::delete(&mut tx, pid).await?;
    tx.commit().await?;
    Ok(())
}
