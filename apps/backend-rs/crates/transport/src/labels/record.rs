//! Label records ↔ proto + store lookups.

use arke::{Entity, World};
use domain::label::LabelInfo;
use persistence::Store;

use crate::sedjiwa::tasks::label::v1 as pb;

#[derive(Debug, Clone)]
pub(crate) struct LabelRecord {
    pub pid: i64,
    pub project_id: String,
    pub name: String,
    pub color: String,
}

pub(crate) fn read_label(world: &World, e: Entity, pid: i64) -> Option<LabelRecord> {
    let info = world.get::<LabelInfo>(e)?;
    Some(LabelRecord {
        pid,
        project_id: info.project_id.clone(),
        name: info.name.clone(),
        color: info.color.clone(),
    })
}

pub(crate) fn to_proto(l: &LabelRecord) -> pb::Label {
    pb::Label {
        id: l.pid.to_string(),
        project_id: l.project_id.clone(),
        name: l.name.clone(),
        color: l.color.clone(),
    }
}

pub(crate) async fn load_label(store: &Store, pid: i64) -> anyhow::Result<Option<LabelRecord>> {
    let pred = format!("pid = {pid}");
    let mut v = store
        .query::<LabelInfo, LabelRecord>(Some(&pred), |world, pairs| {
            pairs
                .iter()
                .filter_map(|(p, e)| read_label(world, *e, *p))
                .collect()
        })
        .await?;
    Ok(v.pop())
}

/// Labels of a project, sorted by (name, pid).
pub(crate) async fn labels_for_project(
    store: &Store,
    project_id: &str,
) -> anyhow::Result<Vec<LabelRecord>> {
    let pj = project_id.to_string();
    let mut v = store
        .query::<LabelInfo, LabelRecord>(None, move |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| read_label(world, *e, *pid))
                .filter(|l| l.project_id == pj)
                .collect()
        })
        .await?;
    v.sort_by(|a, b| a.name.cmp(&b.name).then(a.pid.cmp(&b.pid)));
    Ok(v)
}
