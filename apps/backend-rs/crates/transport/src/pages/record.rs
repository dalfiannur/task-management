//! Page records ↔ proto + store lookups.

use arke::{Entity, World};
use domain::page::{PageAudit, PageInfo};
use persistence::Store;

use crate::sedjiwa::tasks::page::v1 as pb;

#[derive(Debug, Clone)]
pub(crate) struct PageRecord {
    pub pid: i64,
    pub project_id: String,
    pub title: String,
    pub icon: String,
    pub content: String,
    pub order: i32,
    pub created_by: String,
    pub last_edited_by: String,
    pub created_at: String,
    pub updated_at: String,
}

pub(crate) fn read_page(world: &World, e: Entity, pid: i64) -> Option<PageRecord> {
    let info = world.get::<PageInfo>(e)?;
    let audit = world.get::<PageAudit>(e)?;
    Some(PageRecord {
        pid,
        project_id: info.project_id.clone(),
        title: info.title.clone(),
        icon: info.icon.clone(),
        content: info.content.clone(),
        order: info.sort_order,
        created_by: audit.created_by.clone(),
        last_edited_by: audit.last_edited_by.clone(),
        created_at: audit.created_at.clone(),
        updated_at: audit.updated_at.clone(),
    })
}

pub(crate) fn to_proto(p: &PageRecord) -> pb::Page {
    pb::Page {
        id: p.pid.to_string(),
        project_id: p.project_id.clone(),
        title: p.title.clone(),
        icon: p.icon.clone(),
        content: p.content.clone(),
        order: p.order,
        created_by: p.created_by.clone(),
        last_edited_by: p.last_edited_by.clone(),
        created_at: p.created_at.clone(),
        updated_at: p.updated_at.clone(),
    }
}

pub(crate) async fn load_page(store: &Store, pid: i64) -> anyhow::Result<Option<PageRecord>> {
    let pred = format!("pid = {pid}");
    let mut v = store
        .query::<PageInfo, PageRecord>(Some(&pred), |world, pairs| {
            pairs
                .iter()
                .filter_map(|(p, e)| read_page(world, *e, *p))
                .collect()
        })
        .await?;
    Ok(v.pop())
}

/// Pages of a project, sorted by (order, pid).
pub(crate) async fn pages_for_project(
    store: &Store,
    project_id: &str,
) -> anyhow::Result<Vec<PageRecord>> {
    let pj = project_id.to_string();
    let mut v = store
        .query::<PageInfo, PageRecord>(None, move |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| read_page(world, *e, *pid))
                .filter(|p| p.project_id == pj)
                .collect()
        })
        .await?;
    v.sort_by_key(|p| (p.order, p.pid));
    Ok(v)
}

/// How many pages a project has — counted without materialising page bodies.
pub(crate) async fn page_count_for_project(
    store: &Store,
    project_id: &str,
) -> anyhow::Result<u32> {
    let pj = project_id.to_string();
    let hits = store
        .query::<PageInfo, ()>(None, move |world, pairs| {
            pairs
                .iter()
                .filter_map(|(_, e)| world.get::<PageInfo>(*e))
                .filter(|p| p.project_id == pj)
                .map(|_| ())
                .collect()
        })
        .await?;
    Ok(hits.len() as u32)
}
