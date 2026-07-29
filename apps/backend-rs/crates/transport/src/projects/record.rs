//! Flatten project ECS components ↔ the `Project` proto, plus store lookup.

use arke::{Entity, World};
use domain::project::{
    ProjectDates, ProjectDescription, ProjectMembership, ProjectName, ProjectOwnerId,
    ProjectStatus, ProjectStatusComponent,
};
use persistence::Store;

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

/// Read a project entity's components; `None` if a core component is missing.
pub(crate) fn read_project(world: &World, e: Entity, pid: i64) -> Option<ProjectRecord> {
    let name = world.get::<ProjectName>(e)?;
    let owner = world.get::<ProjectOwnerId>(e)?;
    let st = world.get::<ProjectStatusComponent>(e)?;
    let dates = world.get::<ProjectDates>(e);
    Some(ProjectRecord {
        pid,
        name: name.value.clone(),
        description: world.get::<ProjectDescription>(e).map(|d| d.value.clone()),
        status: ProjectStatus::parse(&st.value)?,
        owner_id: owner.value.clone(),
        start_date: dates.and_then(|d| d.start_date.clone()),
        end_date: dates.and_then(|d| d.end_date.clone()),
    })
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
    }
}

/// One project by `pid` (validated integer → safe to inline into the predicate).
pub(crate) async fn load_project(store: &Store, pid: i64) -> anyhow::Result<Option<ProjectRecord>> {
    let pred = format!("pid = {pid}");
    let mut v = store
        .query::<ProjectName, ProjectRecord>(Some(&pred), |world, pairs| {
            pairs
                .iter()
                .filter_map(|(p, e)| read_project(world, *e, *p))
                .collect()
        })
        .await?;
    Ok(v.pop())
}

/// Every project (loads all `ProjectName` entities). O(n) — cache deferred (spec §6).
pub(crate) async fn load_all_projects(store: &Store) -> anyhow::Result<Vec<ProjectRecord>> {
    store
        .query::<ProjectName, ProjectRecord>(None, |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| read_project(world, *e, *pid))
                .collect()
        })
        .await
}

/// True if `user_id` is a member of `project_id`.
pub(crate) async fn is_member(
    store: &Store,
    project_id: &str,
    user_id: &str,
) -> anyhow::Result<bool> {
    let pj = project_id.to_string();
    let uid = user_id.to_string();
    let hits = store
        .query::<ProjectMembership, ()>(None, move |world, pairs| {
            pairs
                .iter()
                .filter_map(|(_, e)| world.get::<ProjectMembership>(*e))
                .filter(|m| m.project_id == pj && m.user_id == uid)
                .map(|_| ())
                .collect()
        })
        .await?;
    Ok(!hits.is_empty())
}

/// Project ids `user_id` is a member of.
pub(crate) async fn member_project_ids(
    store: &Store,
    user_id: &str,
) -> anyhow::Result<Vec<String>> {
    let uid = user_id.to_string();
    store
        .query::<ProjectMembership, String>(None, move |world, pairs| {
            pairs
                .iter()
                .filter_map(|(_, e)| world.get::<ProjectMembership>(*e))
                .filter(|m| m.user_id == uid)
                .map(|m| m.project_id.clone())
                .collect()
        })
        .await
}

/// Membership entity `pid`s for `project_id` (used to cascade-delete on project delete).
pub(crate) async fn membership_pids_for_project(
    store: &Store,
    project_id: &str,
) -> anyhow::Result<Vec<i64>> {
    let pj = project_id.to_string();
    store
        .query::<ProjectMembership, i64>(None, move |world, pairs| {
            pairs
                .iter()
                .filter(|(_, e)| {
                    world
                        .get::<ProjectMembership>(*e)
                        .map(|m| m.project_id == pj)
                        .unwrap_or(false)
                })
                .map(|(pid, _)| *pid)
                .collect()
        })
        .await
}
