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
use domain::sanitize::plain_text;
use domain::user::UserStatus;
use persistence::{SearchDoc, Store};

/// (pid, module_id, title, description, assignee_ids, parent_id)
type TaskRow = (i64, String, String, String, Vec<String>, Option<String>);

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
    let store = Store::connect(&database_url).await?;

    store.clear_index().await?;
    let mut count = 0usize;

    // Projects. A project stores its own id as `project_id`, so the
    // membership filter covers it like any child document.
    let projects: Vec<(i64, String, String)> = sqlx::query_as(
        "SELECT n.pid, n.value, COALESCE(d.value, '') FROM cmp_projectname n \
         LEFT JOIN cmp_projectdescription d ON d.pid = n.pid ORDER BY n.pid",
    )
    .fetch_all(store.pool())
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
    let modules: Vec<(i64, Option<String>)> = sqlx::query_as(
        "SELECT n.pid, p.project_id FROM cmp_modulename n \
         LEFT JOIN cmp_moduleprojectref p ON p.pid = n.pid ORDER BY n.pid",
    )
    .fetch_all(store.pool())
    .await?;
    let module_project: HashMap<String, String> = modules
        .into_iter()
        .filter_map(|(pid, project_id)| project_id.map(|p| (pid.to_string(), p)))
        .collect();

    // Tasks. Skip a task whose module is missing rather than inventing a
    // project_id — same call as the production fix in `move_task`.
    let tasks: Vec<TaskRow> = sqlx::query_as(
        "SELECT i.pid, m.module_id, i.title, i.description, \
                ARRAY(SELECT e.x FROM jsonb_array_elements_text(a.user_ids) \
                      WITH ORDINALITY AS e(x, n) ORDER BY e.n), \
                par.parent_id \
         FROM cmp_taskinfo i \
         JOIN cmp_taskmoduleref m ON m.pid = i.pid \
         LEFT JOIN cmp_taskassignees a ON a.pid = i.pid \
         LEFT JOIN cmp_taskparent par ON par.pid = i.pid \
         ORDER BY i.pid",
    )
    .fetch_all(store.pool())
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
    let pages: Vec<(i64, String, String, String)> = sqlx::query_as(
        "SELECT pid, project_id, title, content FROM cmp_pageinfo ORDER BY pid",
    )
    .fetch_all(store.pool())
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
    let comments: Vec<(i64, String, String)> = sqlx::query_as(
        "SELECT pid, task_id, content FROM cmp_commentinfo ORDER BY pid",
    )
    .fetch_all(store.pool())
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
    let users: Vec<(i64, String, String, String)> = sqlx::query_as(
        "SELECT pr.pid, pr.display_name, ph.value, st.status FROM cmp_userprofile pr \
         JOIN cmp_userphone ph ON ph.pid = pr.pid \
         JOIN cmp_userstatuscomponent st ON st.pid = pr.pid \
         ORDER BY pr.pid",
    )
    .fetch_all(store.pool())
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
