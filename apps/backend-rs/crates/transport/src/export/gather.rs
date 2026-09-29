//! Store → ProjectSnapshot. Project, members, modules, tasks and activity reuse
//! the tested project-scoped loaders other services already call. Labels,
//! comments, pages, media (and its task links), and users stay as inline
//! queries — their record modules are private, or (comments) a per-task loader
//! would turn one pass into N+1 — each filtered in SQL on the indexed column
//! it has, with bound parameters.

use std::collections::{HashMap, HashSet};

use anyhow::Context;
use domain::media::MediaStatus;
use persistence::Store;
use sqlx::Row;

use super::model::{
    ActivityOut, CommentOut, LabelOut, MediaOut, ModuleOut, PageOut, ProjectOut, ProjectSnapshot,
    TaskOut, UserOut,
};
use crate::activity::record::activity_for_project;
use crate::projects::record::{load_project, project_member_ids};
use crate::work::record::modules_for_project;
use crate::work::task_record::tasks_for_modules;

/// Everything about one project, in one shot. Callers get a value they can
/// serialize; nothing here touches proto or the network.
pub(crate) async fn gather(store: &Store, project_id: &str) -> anyhow::Result<ProjectSnapshot> {
    let pid: i64 = project_id
        .parse()
        .with_context(|| format!("export: project id {project_id:?} is not a valid id"))?;

    // --- project -------------------------------------------------------------
    let record = load_project(store, pid)
        .await?
        .ok_or_else(|| anyhow::anyhow!("project {project_id} not found"))?;
    let mut project = ProjectOut {
        id: record.pid.to_string(),
        name: record.name,
        description: record.description.unwrap_or_default(),
        status: record.status.as_str().to_string(),
        owner_id: record.owner_id,
        start_date: record.start_date,
        end_date: record.end_date,
        member_ids: Vec::new(),
    };
    project.member_ids = project_member_ids(store, project_id).await?;

    // --- modules ---------------------------------------------------------------
    let mut modules: Vec<ModuleOut> = modules_for_project(store, project_id)
        .await?
        .into_iter()
        .map(|m| ModuleOut {
            id: m.pid.to_string(),
            name: m.name,
            description: m.description.unwrap_or_default(),
            sort_order: m.order,
        })
        .collect();
    modules.sort_by(|a, b| a.sort_order.cmp(&b.sort_order).then(a.id.cmp(&b.id)));
    // Tasks don't carry a project id — `TaskInfo` only carries `module_id` — so
    // the task query below filters against this project's module ids instead.
    let module_ids: HashSet<String> = modules.iter().map(|m| m.id.clone()).collect();

    // --- tasks -------------------------------------------------------------
    let mut tasks: Vec<TaskOut> = tasks_for_modules(store, module_ids)
        .await?
        .into_iter()
        .map(|t| TaskOut {
            id: t.pid.to_string(),
            module_id: t.module_id,
            title: t.title,
            description: t.description,
            status: t.status.as_str().to_string(),
            priority: t.priority.as_str().to_string(),
            start_date: t.start_date,
            due_date: t.due_date,
            completed_at: t.completed_at,
            sort_order: t.order,
            assignee_ids: t.assignee_ids,
            label_ids: t.label_ids,
            parent_id: t.parent_id,
            blocked_by_ids: t.blocked_by_ids,
            created_at: t.created_at,
            updated_at: t.updated_at,
            created_by: t.created_by,
        })
        .collect();
    // `tasks_for_modules` sorts by (order, pid) across every module it was given;
    // the export wants the CSV grouped by module, so re-sort by (module, order, id).
    tasks.sort_by(|a, b| {
        a.module_id
            .cmp(&b.module_id)
            .then(a.sort_order.cmp(&b.sort_order))
            .then(a.id.cmp(&b.id))
    });
    // Comments don't carry a project id either — `CommentInfo` only carries
    // `task_id` — so the comment query below filters against this project's task
    // ids instead.
    let task_ids: HashSet<String> = tasks.iter().map(|t| t.id.clone()).collect();

    // The project id as the text the `project_id` columns hold.
    let project_key = pid.to_string();

    // --- labels (inline: LabelService's record module is private and this is
    // its only cross-module consumer). ------------------------------------------
    let mut labels = Vec::new();
    for row in sqlx::query("SELECT pid, name, color FROM cmp_labelinfo WHERE project_id = $1")
        .bind(&project_key)
        .fetch_all(store.pool())
        .await?
    {
        labels.push(LabelOut {
            id: row.try_get::<i64, _>("pid")?.to_string(),
            name: row.try_get("name")?,
            color: row.try_get("color")?,
        });
    }
    labels.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));

    // --- comments (inline: `comments_for_task` is per-task, and looping it over
    // every task would be N+1 against this one pass over the indexed `task_id`
    // column, for this project's task ids). ------------------------------------
    let task_id_list: Vec<String> = task_ids.into_iter().collect();
    let mut comments = Vec::new();
    for row in sqlx::query(
        "SELECT pid, task_id, author_id, content, created_at, updated_at,                 ARRAY(SELECT e.x FROM jsonb_array_elements_text(mentioned_user_ids)                       WITH ORDINALITY AS e(x, n) ORDER BY e.n) AS mentioned_user_ids          FROM cmp_commentinfo WHERE task_id = ANY($1)",
    )
    .bind(&task_id_list)
    .fetch_all(store.pool())
    .await?
    {
        comments.push(CommentOut {
            id: row.try_get::<i64, _>("pid")?.to_string(),
            task_id: row.try_get("task_id")?,
            author_id: row.try_get("author_id")?,
            content: row.try_get("content")?,
            mentioned_user_ids: row.try_get("mentioned_user_ids")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        });
    }
    comments.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));

    // --- pages (inline, deliberately: `pages::record::read_page` treats
    // `PageAudit` as required and drops a page that is missing it. For an
    // export, a page with blank "created by"/"last edited by" is a better
    // outcome than a page silently vanishing from the archive, so this block
    // treats the audit row as optional — a LEFT JOIN — and fills defaults
    // instead of reusing that stricter reader.) ---------------------------------
    let mut pages = Vec::new();
    for row in sqlx::query(
        "SELECT i.pid, i.title, i.icon, i.content, i.sort_order,                 COALESCE(a.created_by, '') AS created_by,                 COALESCE(a.last_edited_by, '') AS last_edited_by,                 COALESCE(a.created_at, '') AS created_at,                 COALESCE(a.updated_at, '') AS updated_at          FROM cmp_pageinfo i LEFT JOIN cmp_pageaudit a ON a.pid = i.pid          WHERE i.project_id = $1",
    )
    .bind(&project_key)
    .fetch_all(store.pool())
    .await?
    {
        pages.push(PageOut {
            id: row.try_get::<i64, _>("pid")?.to_string(),
            title: row.try_get("title")?,
            icon: row.try_get("icon")?,
            content: row.try_get("content")?,
            sort_order: row.try_get("sort_order")?,
            created_by: row.try_get("created_by")?,
            last_edited_by: row.try_get("last_edited_by")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        });
    }
    pages.sort_by(|a, b| a.sort_order.cmp(&b.sort_order).then(a.id.cmp(&b.id)));

    // --- activity ------------------------------------------------------------
    // `activity_for_project` already filters in SQL via `idx_cmp_activityinfo_project_id`
    // instead of hydrating the whole table (see its doc comment); it returns
    // newest-first, but the export wants oldest-first, so re-sort ascending.
    let mut activity: Vec<ActivityOut> = activity_for_project(store, project_id)
        .await?
        .into_iter()
        .map(|a| ActivityOut {
            id: a.pid.to_string(),
            actor_id: a.actor_id,
            entity_type: a.entity_type.as_str().to_string(),
            entity_id: a.entity_id,
            action: a.action.as_str().to_string(),
            summary: a.summary,
            created_at: a.created_at,
        })
        .collect();
    activity.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));

    // --- media (ready only, with their task links; inline: MediaService's
    // record module is private and this is its only cross-module consumer).
    // Both filter on the indexed `project_id` column. Links keep their creation
    // order within each file. ---------------------------------------------------
    let mut links_by_media: HashMap<String, Vec<String>> = HashMap::new();
    for row in sqlx::query(
        "SELECT media_file_id, task_id FROM cmp_taskmedialinkdata WHERE project_id = $1 ORDER BY pid",
    )
    .bind(&project_key)
    .fetch_all(store.pool())
    .await?
    {
        links_by_media
            .entry(row.try_get("media_file_id")?)
            .or_default()
            .push(row.try_get("task_id")?);
    }

    let mut media = Vec::new();
    for row in sqlx::query(
        "SELECT pid, original_file_name, mime_type, size, uploaded_by, created_at, storage_key          FROM cmp_mediafileinfo WHERE project_id = $1 AND status = $2",
    )
    .bind(&project_key)
    .bind(MediaStatus::Ready.as_str())
    .fetch_all(store.pool())
    .await?
    {
        media.push(MediaOut {
            id: row.try_get::<i64, _>("pid")?.to_string(),
            file_name: row.try_get("original_file_name")?,
            mime_type: row.try_get("mime_type")?,
            size: row.try_get("size")?,
            uploaded_by: row.try_get("uploaded_by")?,
            created_at: row.try_get("created_at")?,
            task_ids: vec![],
            storage_key: row.try_get("storage_key")?,
        });
    }
    for m in &mut media {
        m.task_ids = links_by_media.remove(&m.id).unwrap_or_default();
    }
    media.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));

    // --- users: only those the archive actually references ------------------
    let mut referenced: HashSet<String> = project.member_ids.iter().cloned().collect();
    referenced.insert(project.owner_id.clone());
    for t in &tasks {
        referenced.extend(t.assignee_ids.iter().cloned());
        referenced.insert(t.created_by.clone());
    }
    for c in &comments {
        referenced.insert(c.author_id.clone());
        referenced.extend(c.mentioned_user_ids.iter().cloned());
    }
    for p in &pages {
        referenced.insert(p.created_by.clone());
        referenced.insert(p.last_edited_by.clone());
    }
    for a in &activity {
        referenced.insert(a.actor_id.clone());
    }
    for m in &media {
        referenced.insert(m.uploaded_by.clone());
    }
    referenced.remove("");

    // Only the referenced users, by pid — not every user in the deployment.
    // A referenced id that is not numeric names no user.
    let user_pids: Vec<i64> = referenced
        .iter()
        .filter_map(|id| id.parse::<i64>().ok())
        .collect();
    let mut users = Vec::new();
    // Id and name only. No phone, no email — the PII decision.
    for row in sqlx::query("SELECT pid, display_name FROM cmp_userprofile WHERE pid = ANY($1)")
        .bind(&user_pids)
        .fetch_all(store.pool())
        .await?
    {
        users.push(UserOut {
            id: row.try_get::<i64, _>("pid")?.to_string(),
            name: row.try_get("display_name")?,
        });
    }
    users.sort_by(|a, b| a.id.cmp(&b.id));

    Ok(ProjectSnapshot {
        project,
        users,
        modules,
        tasks,
        labels,
        comments,
        pages,
        activity,
        media,
    })
}
