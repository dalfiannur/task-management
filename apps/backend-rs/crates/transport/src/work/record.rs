//! Module records ↔ proto + store lookups.

use arke::{Entity, World};
use domain::module::{ModuleDescription, ModuleName, ModuleOrder, ModuleProjectRef};
use persistence::Store;

use crate::sedjiwa::tasks::work::v1 as pb;

#[derive(Debug, Clone)]
pub(crate) struct ModuleRecord {
    pub pid: i64,
    pub name: String,
    pub description: Option<String>,
    pub project_id: String,
    pub order: i32,
}

pub(crate) fn read_module(world: &World, e: Entity, pid: i64) -> Option<ModuleRecord> {
    let name = world.get::<ModuleName>(e)?;
    let pref = world.get::<ModuleProjectRef>(e)?;
    let ord = world.get::<ModuleOrder>(e)?;
    Some(ModuleRecord {
        pid,
        name: name.value.clone(),
        description: world.get::<ModuleDescription>(e).map(|d| d.value.clone()),
        project_id: pref.project_id.clone(),
        order: ord.value,
    })
}

pub(crate) fn to_proto(m: &ModuleRecord) -> pb::Module {
    pb::Module {
        id: m.pid.to_string(),
        name: m.name.clone(),
        description: m.description.clone(),
        order: m.order,
    }
}

pub(crate) async fn load_module(store: &Store, pid: i64) -> anyhow::Result<Option<ModuleRecord>> {
    let pred = format!("pid = {pid}");
    let mut v = store
        .query::<ModuleName, ModuleRecord>(Some(&pred), |world, pairs| {
            pairs
                .iter()
                .filter_map(|(p, e)| read_module(world, *e, *p))
                .collect()
        })
        .await?;
    Ok(v.pop())
}

/// Modules of a project, sorted by order then pid.
pub(crate) async fn modules_for_project(
    store: &Store,
    project_id: &str,
) -> anyhow::Result<Vec<ModuleRecord>> {
    let pj = project_id.to_string();
    let mut v = store
        .query::<ModuleName, ModuleRecord>(None, move |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| read_module(world, *e, *pid))
                .filter(|m| m.project_id == pj)
                .collect()
        })
        .await?;
    v.sort_by_key(|m| (m.order, m.pid));
    Ok(v)
}
