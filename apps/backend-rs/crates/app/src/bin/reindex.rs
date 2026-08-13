//! Rebuild `search_doc` from scratch: `TRUNCATE`, then walk every component
//! table and re-derive the five document kinds.
//!
//! The write-path indexer (`transport::search::indexer`) is best-effort — a
//! failed index write is logged, not retried — so the index can drift from
//! the source of truth over time. This binary is the remedy, and it is also
//! how pre-existing data (never indexed before the search feature shipped)
//! gets backfilled after deploy.
//!
//! The document builders in `crates/transport/src/search/indexer.rs` are
//! `pub(crate)` to `transport`, so this binary — living in `app` — cannot
//! call them; it builds `SearchDoc` values directly instead. **Keep this
//! field mapping identical to `indexer.rs`** — if the two drift, search
//! results drift with them.
//!
//! Env: `DATABASE_URL` (required).

use std::collections::HashMap;

use anyhow::{anyhow, Result};
use domain::comment::CommentInfo;
use domain::module::{ModuleName, ModuleProjectRef};
use domain::page::PageInfo;
use domain::project::{ProjectDescription, ProjectName};
use domain::sanitize::plain_text;
use domain::task::{TaskAssignees, TaskInfo, TaskModuleRef, TaskParent};
use domain::user::{UserPhone, UserProfile, UserStatus, UserStatusComponent};
use persistence::{SearchDoc, Store};

mod kind {
    pub const TASK: &str = "task";
    pub const PAGE: &str = "page";
    pub const COMMENT: &str = "comment";
    pub const PROJECT: &str = "project";
    pub const USER: &str = "user";
}

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    let database_url =
        std::env::var("DATABASE_URL").map_err(|_| anyhow!("DATABASE_URL not set"))?;
    let store = Store::connect(&database_url, domain::register_all).await?;

    store.clear_index().await?;
    let mut count = 0usize;

    // Projects. A project stores its own id as `project_id`, so the
    // membership filter covers it like any child document.
    let projects = store
        .query::<ProjectName, (i64, String, String)>(None, |world, pairs| {
            pairs
                .iter()
                .map(|(pid, e)| {
                    let name = world
                        .get::<ProjectName>(*e)
                        .map(|c| c.value.clone())
                        .unwrap_or_default();
                    let description = world
                        .get::<ProjectDescription>(*e)
                        .map(|c| c.value.clone())
                        .unwrap_or_default();
                    (*pid, name, description)
                })
                .collect()
        })
        .await?;
    for (pid, name, description) in &projects {
        let id = pid.to_string();
        store
            .index_doc(SearchDoc {
                kind: kind::PROJECT.into(),
                entity_id: id.clone(),
                project_id: Some(id),
                title: name.clone(),
                body: plain_text(description),
                assignee_ids: vec![],
                parent_id: None,
            })
            .await?;
        count += 1;
    }

    // Module pid → project_id, so tasks (and through them, comments) can
    // resolve their owning project.
    let modules = store
        .query::<ModuleName, (i64, Option<String>)>(None, |world, pairs| {
            pairs
                .iter()
                .map(|(pid, e)| {
                    (
                        *pid,
                        world
                            .get::<ModuleProjectRef>(*e)
                            .map(|r| r.project_id.clone()),
                    )
                })
                .collect()
        })
        .await?;
    let module_project: HashMap<String, String> = modules
        .into_iter()
        .filter_map(|(pid, project_id)| project_id.map(|p| (pid.to_string(), p)))
        .collect();

    // Tasks. Skip a task whose module is missing rather than inventing a
    // project_id — same call as the production fix in `move_task`.
    let tasks = store
        .query::<TaskInfo, (i64, String, String, String, Vec<String>, Option<String>)>(
            None,
            |world, pairs| {
                pairs
                    .iter()
                    .filter_map(|(pid, e)| {
                        let info = world.get::<TaskInfo>(*e)?;
                        let mref = world.get::<TaskModuleRef>(*e)?;
                        let assignees = world
                            .get::<TaskAssignees>(*e)
                            .map(|a| a.user_ids.clone())
                            .unwrap_or_default();
                        let parent_id =
                            world.get::<TaskParent>(*e).map(|p| p.parent_id.clone());
                        Some((
                            *pid,
                            mref.module_id.clone(),
                            info.title.clone(),
                            info.description.clone(),
                            assignees,
                            parent_id,
                        ))
                    })
                    .collect()
            },
        )
        .await?;
    let mut task_project: HashMap<String, String> = HashMap::new();
    for (pid, module_id, title, description, assignee_ids, parent_id) in &tasks {
        let Some(project_id) = module_project.get(module_id) else {
            continue; // orphaned task (module missing) — no resolvable project
        };
        let id = pid.to_string();
        task_project.insert(id.clone(), project_id.clone());
        store
            .index_doc(SearchDoc {
                kind: kind::TASK.into(),
                entity_id: id,
                project_id: Some(project_id.clone()),
                title: title.clone(),
                body: plain_text(description),
                assignee_ids: assignee_ids.clone(),
                parent_id: parent_id.clone(),
            })
            .await?;
        count += 1;
    }

    // Pages: project_id is stored directly.
    let pages = store
        .query::<PageInfo, (i64, String, String, String)>(None, |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| {
                    let info = world.get::<PageInfo>(*e)?;
                    Some((
                        *pid,
                        info.project_id.clone(),
                        info.title.clone(),
                        info.content.clone(),
                    ))
                })
                .collect()
        })
        .await?;
    for (pid, project_id, title, content) in &pages {
        let id = pid.to_string();
        store
            .index_doc(SearchDoc {
                kind: kind::PAGE.into(),
                entity_id: id,
                project_id: Some(project_id.clone()),
                title: title.clone(),
                body: plain_text(content),
                assignee_ids: vec![],
                parent_id: None,
            })
            .await?;
        count += 1;
    }

    // Comments: no title; skip one whose task is missing — mirrors the task
    // orphan rule above.
    let comments = store
        .query::<CommentInfo, (i64, String, String)>(None, |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| {
                    let info = world.get::<CommentInfo>(*e)?;
                    Some((*pid, info.task_id.clone(), info.content.clone()))
                })
                .collect()
        })
        .await?;
    for (pid, task_id, content) in &comments {
        let Some(project_id) = task_project.get(task_id) else {
            continue; // orphaned comment (task missing) — no resolvable project
        };
        let id = pid.to_string();
        store
            .index_doc(SearchDoc {
                kind: kind::COMMENT.into(),
                entity_id: id,
                project_id: Some(project_id.clone()),
                title: String::new(),
                body: plain_text(content),
                assignee_ids: vec![],
                parent_id: None,
            })
            .await?;
        count += 1;
    }

    // People: only Active users, matching both `search_users` and the write
    // path (suspended users are deindexed there). `project_id: None` — people
    // are global. Phone is not HTML, so it's indexed as-is, not through
    // `plain_text`.
    let users = store
        .query::<UserProfile, (i64, String, String, String)>(None, |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| {
                    let profile = world.get::<UserProfile>(*e)?;
                    let phone = world.get::<UserPhone>(*e)?;
                    let status = world.get::<UserStatusComponent>(*e)?;
                    Some((
                        *pid,
                        profile.display_name.clone(),
                        phone.value.clone(),
                        status.status.clone(),
                    ))
                })
                .collect()
        })
        .await?;
    for (pid, display_name, phone, status) in &users {
        if UserStatus::parse(status) != Some(UserStatus::Active) {
            continue;
        }
        store
            .index_doc(SearchDoc {
                kind: kind::USER.into(),
                entity_id: pid.to_string(),
                project_id: None,
                title: display_name.clone(),
                body: phone.clone(),
                assignee_ids: vec![],
                parent_id: None,
            })
            .await?;
        count += 1;
    }

    println!("reindex: rebuilt {count} documents");
    Ok(())
}
