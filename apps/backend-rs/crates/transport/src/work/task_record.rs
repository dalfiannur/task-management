//! Task records ↔ proto + store lookups.

use std::collections::HashSet;

use arke::{Entity, World};
use domain::task::{
    TaskAssignees, TaskAudit, TaskInfo, TaskLabels, TaskModuleRef, TaskPriority, TaskStatus,
};
use persistence::Store;

use crate::sedjiwa::tasks::work::v1 as pb;

#[derive(Debug, Clone)]
pub(crate) struct TaskRecord {
    pub pid: i64,
    pub module_id: String,
    pub title: String,
    pub description: String,
    pub status: TaskStatus,
    pub priority: TaskPriority,
    pub start_date: Option<String>,
    pub due_date: Option<String>,
    pub order: i32,
    pub assignee_ids: Vec<String>,
    pub label_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub created_by: String,
}

pub(crate) fn read_task(world: &World, e: Entity, pid: i64) -> Option<TaskRecord> {
    let info = world.get::<TaskInfo>(e)?;
    let mref = world.get::<TaskModuleRef>(e)?;
    let audit = world.get::<TaskAudit>(e)?;
    Some(TaskRecord {
        pid,
        module_id: mref.module_id.clone(),
        title: info.title.clone(),
        description: info.description.clone(),
        status: TaskStatus::parse(&info.status)?,
        priority: TaskPriority::parse(&info.priority)?,
        start_date: info.start_date.clone(),
        due_date: info.due_date.clone(),
        order: info.sort_order,
        assignee_ids: world
            .get::<TaskAssignees>(e)
            .map(|a| a.user_ids.clone())
            .unwrap_or_default(),
        label_ids: world
            .get::<TaskLabels>(e)
            .map(|l| l.label_ids.clone())
            .unwrap_or_default(),
        created_at: audit.created_at.clone(),
        updated_at: audit.updated_at.clone(),
        completed_at: audit.completed_at.clone(),
        created_by: audit.created_by.clone(),
    })
}

pub(crate) fn to_proto(t: &TaskRecord) -> pb::Task {
    pb::Task {
        id: t.pid.to_string(),
        module_id: t.module_id.clone(),
        title: t.title.clone(),
        description: t.description.clone(),
        status: t.status.to_proto(),
        priority: t.priority.to_proto(),
        start_date: t.start_date.clone(),
        due_date: t.due_date.clone(),
        order: t.order,
        assignee_ids: t.assignee_ids.clone(),
        label_ids: t.label_ids.clone(),
        created_at: t.created_at.clone(),
        updated_at: t.updated_at.clone(),
        completed_at: t.completed_at.clone(),
        created_by: t.created_by.clone(),
    }
}

pub(crate) async fn load_task(store: &Store, pid: i64) -> anyhow::Result<Option<TaskRecord>> {
    let pred = format!("pid = {pid}");
    let mut v = store
        .query::<TaskInfo, TaskRecord>(Some(&pred), |world, pairs| {
            pairs
                .iter()
                .filter_map(|(p, e)| read_task(world, *e, *p))
                .collect()
        })
        .await?;
    Ok(v.pop())
}

/// Tasks in a module, sorted by (order, pid).
pub(crate) async fn tasks_for_module(
    store: &Store,
    module_id: &str,
) -> anyhow::Result<Vec<TaskRecord>> {
    let m = module_id.to_string();
    let mut v = store
        .query::<TaskInfo, TaskRecord>(None, move |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| read_task(world, *e, *pid))
                .filter(|t| t.module_id == m)
                .collect()
        })
        .await?;
    v.sort_by_key(|t| (t.order, t.pid));
    Ok(v)
}

/// Task entity `pid`s in a module (for cascade delete).
pub(crate) async fn task_pids_for_module(
    store: &Store,
    module_id: &str,
) -> anyhow::Result<Vec<i64>> {
    let m = module_id.to_string();
    store
        .query::<TaskInfo, i64>(None, move |world, pairs| {
            pairs
                .iter()
                .filter(|(_, e)| {
                    world
                        .get::<TaskModuleRef>(*e)
                        .map(|r| r.module_id == m)
                        .unwrap_or(false)
                })
                .map(|(pid, _)| *pid)
                .collect()
        })
        .await
}

/// Tasks whose module is one of `module_ids`, sorted by (order, pid).
pub(crate) async fn tasks_for_modules(
    store: &Store,
    module_ids: HashSet<String>,
) -> anyhow::Result<Vec<TaskRecord>> {
    let mut v = store
        .query::<TaskInfo, TaskRecord>(None, move |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| read_task(world, *e, *pid))
                .filter(|t| module_ids.contains(&t.module_id))
                .collect()
        })
        .await?;
    v.sort_by_key(|t| (t.order, t.pid));
    Ok(v)
}
