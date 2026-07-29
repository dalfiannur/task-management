//! Activity records ↔ proto + store lookups.

use std::collections::HashSet;

use arke::{Entity, World};
use domain::activity::{ActivityAction, ActivityChanges, ActivityInfo, EntityType, FieldChange};
use persistence::Store;

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
    let pj = project_id.to_string();
    let v = store
        .query::<ActivityInfo, ActivityRecord>(None, move |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| read_activity(world, *e, *pid))
                .filter(|a| a.project_id == pj)
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
    let (et, eid) = (entity_type, entity_id.to_string());
    let v = store
        .query::<ActivityInfo, ActivityRecord>(None, move |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| read_activity(world, *e, *pid))
                .filter(|a| a.entity_type == et && a.entity_id == eid)
                .collect()
        })
        .await?;
    Ok(desc(v))
}

/// Recent activity across `projects` (or all projects if `None`, for admins).
pub(crate) async fn activity_recent(
    store: &Store,
    projects: Option<HashSet<String>>,
) -> anyhow::Result<Vec<ActivityRecord>> {
    let v = store
        .query::<ActivityInfo, ActivityRecord>(None, move |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| read_activity(world, *e, *pid))
                .filter(|a| projects.as_ref().is_none_or(|set| set.contains(&a.project_id)))
                .collect()
        })
        .await?;
    Ok(desc(v))
}
