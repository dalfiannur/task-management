//! Store → ProjectSnapshot. One pass per component family, filtered in the
//! closure — the pattern every other record module here uses (`labels_for_project`).

use std::collections::{HashMap, HashSet};

use domain::activity::ActivityInfo;
use domain::comment::CommentInfo;
use domain::label::LabelInfo;
use domain::media::{MediaFileInfo, TaskMediaLinkData};
use domain::module::{ModuleDescription, ModuleName, ModuleOrder, ModuleProjectRef};
use domain::page::{PageAudit, PageInfo};
use domain::project::{
    ProjectDates, ProjectDescription, ProjectMembership, ProjectName, ProjectOwnerId,
    ProjectStatusComponent,
};
use domain::task::{
    TaskAssignees, TaskAudit, TaskBlockedBy, TaskInfo, TaskLabels, TaskModuleRef, TaskParent,
};
use domain::user::UserProfile;
use persistence::Store;

use super::model::*;

/// Everything about one project, in one shot. Callers get a value they can
/// serialize; nothing here touches proto or the network.
pub(crate) async fn gather(store: &Store, project_id: &str) -> anyhow::Result<ProjectSnapshot> {
    let pid: i64 = project_id.parse()?;

    // --- project -----------------------------------------------------------
    let mut project = store
        .query::<ProjectName, ProjectOut>(Some(&format!("pid = {pid}")), |w, pairs| {
            pairs
                .iter()
                .filter_map(|(p, e)| {
                    let name = w.get::<ProjectName>(*e)?;
                    let dates = w.get::<ProjectDates>(*e);
                    Some(ProjectOut {
                        id: p.to_string(),
                        name: name.value.clone(),
                        description: w
                            .get::<ProjectDescription>(*e)
                            .map(|d| d.value.clone())
                            .unwrap_or_default(),
                        status: w
                            .get::<ProjectStatusComponent>(*e)
                            .map(|s| s.value.clone())
                            .unwrap_or_default(),
                        owner_id: w
                            .get::<ProjectOwnerId>(*e)
                            .map(|o| o.value.clone())
                            .unwrap_or_default(),
                        start_date: dates.and_then(|d| d.start_date.clone()),
                        end_date: dates.and_then(|d| d.end_date.clone()),
                        member_ids: vec![],
                    })
                })
                .collect()
        })
        .await?
        .pop()
        .ok_or_else(|| anyhow::anyhow!("project {project_id} not found"))?;

    let pj = project_id.to_string();
    project.member_ids = store
        .query::<ProjectMembership, String>(None, {
            let pj = pj.clone();
            move |w, pairs| {
                pairs
                    .iter()
                    .filter_map(|(_, e)| w.get::<ProjectMembership>(*e))
                    .filter(|m| m.project_id == pj)
                    .map(|m| m.user_id.clone())
                    .collect()
            }
        })
        .await?;

    // --- modules -----------------------------------------------------------
    let mut modules = store
        .query::<ModuleProjectRef, ModuleOut>(None, {
            let pj = pj.clone();
            move |w, pairs| {
                pairs
                    .iter()
                    .filter(|(_, e)| {
                        w.get::<ModuleProjectRef>(*e).is_some_and(|r| r.project_id == pj)
                    })
                    .filter_map(|(p, e)| {
                        Some(ModuleOut {
                            id: p.to_string(),
                            name: w.get::<ModuleName>(*e)?.value.clone(),
                            description: w
                                .get::<ModuleDescription>(*e)
                                .map(|d| d.value.clone())
                                .unwrap_or_default(),
                            sort_order: w.get::<ModuleOrder>(*e).map(|o| o.value).unwrap_or(0),
                        })
                    })
                    .collect()
            }
        })
        .await?;
    modules.sort_by(|a, b| a.sort_order.cmp(&b.sort_order).then(a.id.cmp(&b.id)));
    let module_ids: HashSet<String> = modules.iter().map(|m| m.id.clone()).collect();

    // --- tasks -------------------------------------------------------------
    let mut tasks = store
        .query::<TaskInfo, TaskOut>(None, {
            let mods = module_ids.clone();
            move |w, pairs| {
                pairs
                    .iter()
                    .filter_map(|(p, e)| {
                        let info = w.get::<TaskInfo>(*e)?;
                        let module_id = w.get::<TaskModuleRef>(*e)?.module_id.clone();
                        if !mods.contains(&module_id) {
                            return None;
                        }
                        let audit = w.get::<TaskAudit>(*e);
                        Some(TaskOut {
                            id: p.to_string(),
                            module_id,
                            title: info.title.clone(),
                            description: info.description.clone(),
                            status: info.status.clone(),
                            priority: info.priority.clone(),
                            start_date: info.start_date.clone(),
                            due_date: info.due_date.clone(),
                            completed_at: audit.and_then(|a| a.completed_at.clone()),
                            sort_order: info.sort_order,
                            assignee_ids: w
                                .get::<TaskAssignees>(*e)
                                .map(|a| a.user_ids.clone())
                                .unwrap_or_default(),
                            label_ids: w
                                .get::<TaskLabels>(*e)
                                .map(|l| l.label_ids.clone())
                                .unwrap_or_default(),
                            parent_id: w.get::<TaskParent>(*e).map(|p| p.parent_id.clone()),
                            blocked_by_ids: w
                                .get::<TaskBlockedBy>(*e)
                                .map(|b| b.task_ids.clone())
                                .unwrap_or_default(),
                            created_at: audit.map(|a| a.created_at.clone()).unwrap_or_default(),
                            updated_at: audit.map(|a| a.updated_at.clone()).unwrap_or_default(),
                            created_by: audit.map(|a| a.created_by.clone()).unwrap_or_default(),
                        })
                    })
                    .collect()
            }
        })
        .await?;
    tasks.sort_by(|a, b| {
        a.module_id
            .cmp(&b.module_id)
            .then(a.sort_order.cmp(&b.sort_order))
            .then(a.id.cmp(&b.id))
    });
    let task_ids: HashSet<String> = tasks.iter().map(|t| t.id.clone()).collect();

    // --- labels ------------------------------------------------------------
    let mut labels = store
        .query::<LabelInfo, LabelOut>(None, {
            let pj = pj.clone();
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

    // --- comments ----------------------------------------------------------
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

    // --- pages -------------------------------------------------------------
    let mut pages = store
        .query::<PageInfo, PageOut>(None, {
            let pj = pj.clone();
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

    // --- activity ----------------------------------------------------------
    let mut activity = store
        .query::<ActivityInfo, ActivityOut>(None, {
            let pj = pj.clone();
            move |w, pairs| {
                pairs
                    .iter()
                    .filter_map(|(p, e)| {
                        let a = w.get::<ActivityInfo>(*e)?;
                        (a.project_id == pj).then(|| ActivityOut {
                            id: p.to_string(),
                            actor_id: a.actor_id.clone(),
                            entity_type: a.entity_type.clone(),
                            entity_id: a.entity_id.clone(),
                            action: a.action.clone(),
                            summary: a.summary.clone(),
                            created_at: a.created_at.clone(),
                        })
                    })
                    .collect()
            }
        })
        .await?;
    activity.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));

    // --- media (ready only, with their task links) -------------------------
    let links = store
        .query::<TaskMediaLinkData, (String, String)>(None, {
            let pj = pj.clone();
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
            let pj = pj.clone();
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
