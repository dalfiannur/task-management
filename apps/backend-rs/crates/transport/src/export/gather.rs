//! Store → ProjectSnapshot. Project, members, modules, tasks and activity reuse
//! the tested project-scoped loaders other services already call — one place
//! reads components, this module owns the export shape. Labels, comments, pages
//! and media stay as inline queries (see the notes at each block for why).

use std::collections::{HashMap, HashSet};

use anyhow::Context;
use domain::comment::CommentInfo;
use domain::label::LabelInfo;
use domain::media::{MediaFileInfo, TaskMediaLinkData};
use domain::page::{PageAudit, PageInfo};
use domain::user::UserProfile;
use persistence::Store;

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
    let modules: Vec<ModuleOut> = modules_for_project(store, project_id)
        .await?
        .into_iter()
        .map(|m| ModuleOut {
            id: m.pid.to_string(),
            name: m.name,
            description: m.description.unwrap_or_default(),
            sort_order: m.order,
        })
        .collect();
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

    // --- labels (inline: LabelService's record module is private and this is
    // its only cross-module consumer) ---------------------------------------
    let mut labels = store
        .query::<LabelInfo, LabelOut>(None, {
            let pj = project_id.to_string();
            move |w, pairs| {
                pairs
                    .iter()
                    .filter_map(|(p, e)| {
                        let l = w.get::<LabelInfo>(*e)?;
                        (l.project_id == pj).then(|| LabelOut {
                            id: p.to_string(),
                            name: l.name.clone(),
                            color: l.color.clone(),
                        })
                    })
                    .collect()
            }
        })
        .await?;
    labels.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));

    // --- comments (inline: `comments_for_task` is per-task, and looping it over
    // every task would be N+1 against this one filtered pass) -----------------
    let mut comments = store
        .query::<CommentInfo, CommentOut>(None, {
            let ids = task_ids.clone();
            move |w, pairs| {
                pairs
                    .iter()
                    .filter_map(|(p, e)| {
                        let c = w.get::<CommentInfo>(*e)?;
                        ids.contains(&c.task_id).then(|| CommentOut {
                            id: p.to_string(),
                            task_id: c.task_id.clone(),
                            author_id: c.author_id.clone(),
                            content: c.content.clone(),
                            mentioned_user_ids: c.mentioned_user_ids.clone(),
                            created_at: c.created_at.clone(),
                            updated_at: c.updated_at.clone(),
                        })
                    })
                    .collect()
            }
        })
        .await?;
    comments.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));

    // --- pages (inline, deliberately: `pages::record::read_page` treats
    // `PageAudit` as required and drops a page that is missing it. For an
    // export, a page with blank "created by"/"last edited by" is a better
    // outcome than a page silently vanishing from the archive, so this block
    // treats the audit component as optional and fills defaults instead of
    // reusing that stricter reader.) -----------------------------------------
    let mut pages = store
        .query::<PageInfo, PageOut>(None, {
            let pj = project_id.to_string();
            move |w, pairs| {
                pairs
                    .iter()
                    .filter_map(|(p, e)| {
                        let pg = w.get::<PageInfo>(*e)?;
                        if pg.project_id != pj {
                            return None;
                        }
                        let a = w.get::<PageAudit>(*e);
                        Some(PageOut {
                            id: p.to_string(),
                            title: pg.title.clone(),
                            icon: pg.icon.clone(),
                            content: pg.content.clone(),
                            sort_order: pg.sort_order,
                            created_by: a.map(|a| a.created_by.clone()).unwrap_or_default(),
                            last_edited_by: a.map(|a| a.last_edited_by.clone()).unwrap_or_default(),
                            created_at: a.map(|a| a.created_at.clone()).unwrap_or_default(),
                            updated_at: a.map(|a| a.updated_at.clone()).unwrap_or_default(),
                        })
                    })
                    .collect()
            }
        })
        .await?;
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
    // record module is private and this is its only cross-module consumer) ---
    let links = store
        .query::<TaskMediaLinkData, (String, String)>(None, {
            let pj = project_id.to_string();
            move |w, pairs| {
                pairs
                    .iter()
                    .filter_map(|(_, e)| w.get::<TaskMediaLinkData>(*e))
                    .filter(|l| l.project_id == pj)
                    .map(|l| (l.media_file_id.clone(), l.task_id.clone()))
                    .collect()
            }
        })
        .await?;
    let mut links_by_media: HashMap<String, Vec<String>> = HashMap::new();
    for (media_id, task_id) in links {
        links_by_media.entry(media_id).or_default().push(task_id);
    }

    let mut media = store
        .query::<MediaFileInfo, MediaOut>(None, {
            let pj = project_id.to_string();
            move |w, pairs| {
                pairs
                    .iter()
                    .filter_map(|(p, e)| {
                        let m = w.get::<MediaFileInfo>(*e)?;
                        (m.project_id == pj && m.status == "ready").then(|| MediaOut {
                            id: p.to_string(),
                            file_name: m.original_file_name.clone(),
                            mime_type: m.mime_type.clone(),
                            size: m.size,
                            uploaded_by: m.uploaded_by.clone(),
                            created_at: m.created_at.clone(),
                            task_ids: vec![],
                            storage_key: m.storage_key.clone(),
                        })
                    })
                    .collect()
            }
        })
        .await?;
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

    let mut users = store
        .query::<UserProfile, UserOut>(None, move |w, pairs| {
            pairs
                .iter()
                .filter_map(|(p, e)| {
                    let id = p.to_string();
                    if !referenced.contains(&id) {
                        return None;
                    }
                    // Id and name only. No phone, no email — the PII decision.
                    Some(UserOut {
                        id,
                        name: w.get::<UserProfile>(*e)?.display_name.clone(),
                    })
                })
                .collect()
        })
        .await?;
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
