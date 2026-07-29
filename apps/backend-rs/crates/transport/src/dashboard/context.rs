//! Per-request aggregation context: scope + lookup maps + all tasks, loaded once.

use std::collections::{HashMap, HashSet};

use auth::AuthUser;
use persistence::Store;

use crate::projects::record::{load_all_projects, member_project_ids};
use crate::sedjiwa::tasks::dashboard::v1 as pb;
use crate::work::record::load_all_modules;
use crate::work::task_record::{load_all_tasks, to_proto as task_to_proto, TaskRecord};

pub(crate) struct Context {
    /// Member project ids; `None` = admin (all projects).
    pub scope: Option<HashSet<String>>,
    pub module_to_project: HashMap<String, String>,
    pub module_names: HashMap<String, String>,
    pub project_names: HashMap<String, String>,
    pub tasks: Vec<TaskRecord>,
}

impl Context {
    pub async fn load(store: &Store, auth: &AuthUser) -> anyhow::Result<Self> {
        let scope = if auth.is_admin() {
            None
        } else {
            Some(
                member_project_ids(store, &auth.id)
                    .await?
                    .into_iter()
                    .collect(),
            )
        };
        let mut module_to_project = HashMap::new();
        let mut module_names = HashMap::new();
        for m in load_all_modules(store).await? {
            module_to_project.insert(m.pid.to_string(), m.project_id);
            module_names.insert(m.pid.to_string(), m.name);
        }
        let project_names = load_all_projects(store)
            .await?
            .into_iter()
            .map(|p| (p.pid.to_string(), p.name))
            .collect();
        let tasks = load_all_tasks(store).await?;
        Ok(Self {
            scope,
            module_to_project,
            module_names,
            project_names,
            tasks,
        })
    }

    fn task_project(&self, t: &TaskRecord) -> Option<&String> {
        self.module_to_project.get(&t.module_id)
    }

    /// Whether a task is in the caller's scope.
    pub fn in_scope(&self, t: &TaskRecord) -> bool {
        match self.task_project(t) {
            Some(pj) => self.scope.as_ref().is_none_or(|s| s.contains(pj)),
            None => false,
        }
    }

    /// Tasks visible to the caller.
    pub fn scoped_tasks(&self) -> Vec<&TaskRecord> {
        self.tasks.iter().filter(|t| self.in_scope(t)).collect()
    }

    /// The projects in scope (member projects, or all for admin).
    pub fn scoped_projects(&self) -> Vec<String> {
        match &self.scope {
            Some(s) => s.iter().cloned().collect(),
            None => self.project_names.keys().cloned().collect(),
        }
    }

    pub fn project_name(&self, project_id: &str) -> String {
        self.project_names.get(project_id).cloned().unwrap_or_default()
    }

    /// Enrich a task with project/module context for cross-project lists.
    pub fn to_mytask(&self, t: &TaskRecord) -> pb::MyTask {
        let project_id = self.task_project(t).cloned().unwrap_or_default();
        pb::MyTask {
            task: Some(task_to_proto(t)),
            project_name: self.project_name(&project_id),
            module_name: self.module_names.get(&t.module_id).cloned().unwrap_or_default(),
            project_id,
        }
    }
}

/// Today as ISO `yyyy-MM-dd` (UTC).
pub(crate) fn today() -> String {
    time::OffsetDateTime::now_utc().date().to_string()
}

/// `today + days` as ISO `yyyy-MM-dd`.
pub(crate) fn date_plus(days: u32) -> String {
    (time::OffsetDateTime::now_utc() + time::Duration::days(days as i64))
        .date()
        .to_string()
}
