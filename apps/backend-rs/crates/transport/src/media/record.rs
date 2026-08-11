//! Media & link records ↔ proto + store lookups.

use arke::{Entity, World};
use domain::media::{MediaFileInfo, MediaStatus, TaskMediaLinkData};
use persistence::Store;

use crate::sedjiwa::tasks::media::v1 as pb;

#[derive(Debug, Clone)]
pub(crate) struct MediaRecord {
    pub pid: i64,
    pub project_id: String,
    pub file_name: String,
    pub original_file_name: String,
    pub mime_type: String,
    pub size: i64,
    pub storage_key: String,
    pub uploaded_by: String,
    pub created_at: String,
    pub status: MediaStatus,
}

pub(crate) fn read_media(world: &World, e: Entity, pid: i64) -> Option<MediaRecord> {
    let info = world.get::<MediaFileInfo>(e)?;
    Some(MediaRecord {
        pid,
        project_id: info.project_id.clone(),
        file_name: info.file_name.clone(),
        original_file_name: info.original_file_name.clone(),
        mime_type: info.mime_type.clone(),
        size: info.size,
        storage_key: info.storage_key.clone(),
        uploaded_by: info.uploaded_by.clone(),
        created_at: info.created_at.clone(),
        status: MediaStatus::parse(&info.status)?,
    })
}

pub(crate) fn to_proto(m: &MediaRecord) -> pb::MediaFile {
    pb::MediaFile {
        id: m.pid.to_string(),
        project_id: m.project_id.clone(),
        file_name: m.file_name.clone(),
        original_file_name: m.original_file_name.clone(),
        mime_type: m.mime_type.clone(),
        size: m.size,
        uploaded_by: m.uploaded_by.clone(),
        created_at: m.created_at.clone(),
        status: m.status.to_proto(),
    }
}

pub(crate) async fn load_media(store: &Store, pid: i64) -> anyhow::Result<Option<MediaRecord>> {
    let pred = format!("pid = {pid}");
    let mut v = store
        .query::<MediaFileInfo, MediaRecord>(Some(&pred), |world, pairs| {
            pairs
                .iter()
                .filter_map(|(p, e)| read_media(world, *e, *p))
                .collect()
        })
        .await?;
    Ok(v.pop())
}

/// Ready files of a project, newest first (by created_at then pid).
pub(crate) async fn ready_media_for_project(
    store: &Store,
    project_id: &str,
) -> anyhow::Result<Vec<MediaRecord>> {
    let pj = project_id.to_string();
    let mut v = store
        .query::<MediaFileInfo, MediaRecord>(None, move |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| read_media(world, *e, *pid))
                .filter(|m| m.project_id == pj && m.status == MediaStatus::Ready)
                .collect()
        })
        .await?;
    v.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.pid.cmp(&a.pid)));
    Ok(v)
}

/// How many *ready* files a project has — same filter as `ready_media_for_project`,
/// counted without materialising the records.
pub(crate) async fn ready_media_count_for_project(
    store: &Store,
    project_id: &str,
) -> anyhow::Result<u32> {
    let pj = project_id.to_string();
    let hits = store
        .query::<MediaFileInfo, ()>(None, move |world, pairs| {
            pairs
                .iter()
                .filter_map(|(_, e)| world.get::<MediaFileInfo>(*e))
                .filter(|m| {
                    m.project_id == pj && MediaStatus::parse(&m.status) == Some(MediaStatus::Ready)
                })
                .map(|_| ())
                .collect()
        })
        .await?;
    Ok(hits.len() as u32)
}

// ── Task↔media links ─────────────────────────────────────────────────────────

pub(crate) async fn link_exists(
    store: &Store,
    task_id: &str,
    media_file_id: &str,
) -> anyhow::Result<bool> {
    let (t, m) = (task_id.to_string(), media_file_id.to_string());
    let hits = store
        .query::<TaskMediaLinkData, ()>(None, move |world, pairs| {
            pairs
                .iter()
                .filter_map(|(_, e)| world.get::<TaskMediaLinkData>(*e))
                .filter(|l| l.task_id == t && l.media_file_id == m)
                .map(|_| ())
                .collect()
        })
        .await?;
    Ok(!hits.is_empty())
}

/// Link entity pids matching a predicate over `TaskMediaLinkData`.
async fn link_pids_where(
    store: &Store,
    pred: impl Fn(&TaskMediaLinkData) -> bool + Send + 'static,
) -> anyhow::Result<Vec<i64>> {
    store
        .query::<TaskMediaLinkData, i64>(None, move |world, pairs| {
            pairs
                .iter()
                .filter(|(_, e)| {
                    world
                        .get::<TaskMediaLinkData>(*e)
                        .map(&pred)
                        .unwrap_or(false)
                })
                .map(|(pid, _)| *pid)
                .collect()
        })
        .await
}

pub(crate) async fn link_pids_for_media(
    store: &Store,
    media_file_id: &str,
) -> anyhow::Result<Vec<i64>> {
    let m = media_file_id.to_string();
    link_pids_where(store, move |l| l.media_file_id == m).await
}

pub(crate) async fn link_pids_for_task_media(
    store: &Store,
    task_id: &str,
    media_file_id: &str,
) -> anyhow::Result<Vec<i64>> {
    let (t, m) = (task_id.to_string(), media_file_id.to_string());
    link_pids_where(store, move |l| l.task_id == t && l.media_file_id == m).await
}

/// Media file ids linked to `task_id`.
pub(crate) async fn media_ids_for_task(
    store: &Store,
    task_id: &str,
) -> anyhow::Result<Vec<String>> {
    let t = task_id.to_string();
    store
        .query::<TaskMediaLinkData, String>(None, move |world, pairs| {
            pairs
                .iter()
                .filter_map(|(_, e)| world.get::<TaskMediaLinkData>(*e))
                .filter(|l| l.task_id == t)
                .map(|l| l.media_file_id.clone())
                .collect()
        })
        .await
}
