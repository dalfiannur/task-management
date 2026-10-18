//! Saved-view rows ↔ proto, plus every read and write the view flows make.
//!
//! Plain sqlx over `cmp_savedview`. A saved view is one entity with one row.

use domain::view::ViewLayout;
use persistence::{entity, Store};
use sqlx::postgres::PgRow;
use sqlx::Row;

use crate::sedjiwa::tasks::view::v1 as pb;

#[derive(Debug, Clone)]
pub(crate) struct ViewRecord {
    pub pid: i64,
    pub project_id: String,
    pub owner_id: String,
    pub name: String,
    pub query: String,
    pub layout: ViewLayout,
    pub shared: bool,
    pub created_at: String,
}

const SELECT_VIEW: &str =
    "SELECT pid, project_id, owner_id, name, query, layout, shared, created_at FROM cmp_savedview";

fn read_view(row: &PgRow) -> sqlx::Result<ViewRecord> {
    let layout: String = row.try_get("layout")?;
    Ok(ViewRecord {
        pid: row.try_get("pid")?,
        project_id: row.try_get("project_id")?,
        owner_id: row.try_get("owner_id")?,
        name: row.try_get("name")?,
        query: row.try_get("query")?,
        // An unknown stored layout opens as a list rather than dropping the view.
        layout: ViewLayout::parse(&layout).unwrap_or(ViewLayout::List),
        shared: row.try_get("shared")?,
        created_at: row.try_get("created_at")?,
    })
}

pub(crate) fn to_proto(v: &ViewRecord) -> pb::SavedView {
    pb::SavedView {
        id: v.pid.to_string(),
        project_id: v.project_id.clone(),
        owner_id: v.owner_id.clone(),
        name: v.name.clone(),
        query: v.query.clone(),
        layout: v.layout.to_proto(),
        shared: v.shared,
        created_at: v.created_at.clone(),
    }
}

pub(crate) async fn load_view(store: &Store, pid: i64) -> anyhow::Result<Option<ViewRecord>> {
    let row = sqlx::query(&format!("{SELECT_VIEW} WHERE pid = $1"))
        .bind(pid)
        .fetch_optional(store.pool())
        .await?;
    Ok(row.as_ref().map(read_view).transpose()?)
}

/// `user_id`'s own views in the project plus every shared one, oldest first.
pub(crate) async fn views_visible_to(
    store: &Store,
    project_id: &str,
    user_id: &str,
) -> anyhow::Result<Vec<ViewRecord>> {
    let rows = sqlx::query(&format!(
        "{SELECT_VIEW} WHERE project_id = $1 AND (shared OR owner_id = $2) ORDER BY pid"
    ))
    .bind(project_id)
    .bind(user_id)
    .fetch_all(store.pool())
    .await?;
    Ok(rows.iter().map(read_view).collect::<sqlx::Result<_>>()?)
}

pub(crate) struct NewView<'a> {
    pub project_id: &'a str,
    pub owner_id: &'a str,
    pub name: &'a str,
    pub query: &'a str,
    pub layout: ViewLayout,
    pub shared: bool,
    pub created_at: &'a str,
}

pub(crate) async fn create_view(store: &Store, v: NewView<'_>) -> anyhow::Result<i64> {
    let mut tx = store.pool().begin().await?;
    let pid = entity::new_pid(&mut tx).await?;
    sqlx::query(
        "INSERT INTO cmp_savedview (pid, project_id, owner_id, name, query, layout, shared, created_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(pid)
    .bind(v.project_id)
    .bind(v.owner_id)
    .bind(v.name)
    .bind(v.query)
    .bind(v.layout.as_str())
    .bind(v.shared)
    .bind(v.created_at)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(pid)
}

/// Set the fields that are `Some`; leave the rest.
pub(crate) async fn update_view(
    store: &Store,
    pid: i64,
    name: Option<String>,
    query: Option<String>,
    layout: Option<ViewLayout>,
    shared: Option<bool>,
) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    if entity::touch(&mut tx, pid).await? {
        sqlx::query(
            "UPDATE cmp_savedview SET name = COALESCE($2, name), query = COALESCE($3, query), \
             layout = COALESCE($4, layout), shared = COALESCE($5, shared) WHERE pid = $1",
        )
        .bind(pid)
        .bind(name)
        .bind(query)
        .bind(layout.map(|l| l.as_str()))
        .bind(shared)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
    }
    Ok(())
}

pub(crate) async fn delete_view(store: &Store, pid: i64) -> anyhow::Result<()> {
    let mut conn = store.pool().acquire().await?;
    entity::delete(&mut conn, pid).await?;
    Ok(())
}
