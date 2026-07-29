//! MediaService: presigned upload (2-step), list/download/delete, task links.

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::media::{MediaFileInfo, MediaStatus, TaskMediaLinkData};
use persistence::Store;
use storage::{new_storage_key, Storage};

use super::record::{
    link_exists, link_pids_for_media, link_pids_for_task_media, load_media, media_ids_for_task,
    ready_media_for_project, to_proto, MediaRecord,
};
use super::{
    internal, parse_pid, require_auth, require_member, require_uploader_owner_or_admin, StorageExt,
    StoreExt,
};
use crate::activity::record;
use domain::activity::{ActivityAction, EntityType};
use crate::sedjiwa::tasks::media::v1 as pb;
use crate::sedjiwa::tasks::media::v1::media_service_connect::MediaServiceBuilder;
use crate::work::task_project_id;

const PUT_TTL_SECS: u32 = 3_600; // 1h to upload
const GET_TTL_SECS: u32 = 300; // 5m download

fn now_iso() -> String {
    use time::format_description::well_known::Rfc3339;
    time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}

async fn require_media(store: &Store, pid: i64) -> Result<MediaRecord, ConnectError> {
    load_media(store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("media file not found"))
}

/// Member: create a Pending file row + presigned PUT URL (client uploads direct).
async fn create_media_upload(
    Extension(store): StoreExt,
    Extension(storage): StorageExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::CreateMediaUploadRequest>,
) -> Result<ConnectResponse<pb::CreateMediaUploadResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    require_member(&store, &r.project_id, &auth).await?;
    let file_name = r.file_name.trim();
    if file_name.is_empty() {
        return Err(ConnectError::new_invalid_argument("file_name is required"));
    }
    let storage_key = new_storage_key(&r.project_id, file_name);
    let pid = store
        .create((MediaFileInfo {
            project_id: r.project_id.clone(),
            file_name: file_name.to_string(),
            original_file_name: file_name.to_string(),
            mime_type: r.mime_type.clone(),
            size: r.size,
            storage_key: storage_key.clone(),
            uploaded_by: auth.id.clone(),
            created_at: now_iso(),
            status: MediaStatus::Pending.as_str().to_string(),
        },))
        .await
        .map_err(internal)?;
    let upload_url = storage
        .presign_put(&storage_key, &r.mime_type, PUT_TTL_SECS)
        .await
        .map_err(internal)?;
    Ok(ConnectResponse::new(pb::CreateMediaUploadResponse {
        media_file_id: pid.to_string(),
        upload_url,
        storage_key,
    }))
}

/// Member: verify the object exists (HEAD → real size) and mark Ready.
async fn complete_media_upload(
    Extension(store): StoreExt,
    Extension(storage): StorageExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::CompleteMediaUploadRequest>,
) -> Result<ConnectResponse<pb::MediaFile>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.media_file_id)?;
    let m = require_media(&store, pid).await?;
    require_member(&store, &m.project_id, &auth).await?;
    let size = storage
        .head(&m.storage_key)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_failed_precondition("upload not found in storage"))?
        as i64;
    store
        .update(pid, move |w, e| {
            if let Some(info) = w.get::<MediaFileInfo>(e).cloned() {
                w.remove::<MediaFileInfo>(e);
                w.insert(
                    e,
                    MediaFileInfo {
                        status: MediaStatus::Ready.as_str().to_string(),
                        size,
                        ..info
                    },
                );
            }
        })
        .await
        .map_err(internal)?;
    let m = require_media(&store, pid).await?;
    record(
        &store,
        &m.project_id,
        &auth.id,
        EntityType::Media,
        &pid.to_string(),
        ActivityAction::Created,
        format!("uploaded {}", m.file_name),
        vec![],
    )
    .await;
    Ok(ConnectResponse::new(to_proto(&m)))
}

/// Member: Ready files of a project (no URLs — cheap list).
async fn list_project_media(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListProjectMediaRequest>,
) -> Result<ConnectResponse<pb::ListMediaResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    require_member(&store, &r.project_id, &auth).await?;
    let files = ready_media_for_project(&store, &r.project_id)
        .await
        .map_err(internal)?;
    Ok(ConnectResponse::new(pb::ListMediaResponse {
        files: files.iter().map(to_proto).collect(),
    }))
}

/// Member: short-TTL presigned GET URL.
async fn get_media_download_url(
    Extension(store): StoreExt,
    Extension(storage): StorageExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::GetMediaDownloadUrlRequest>,
) -> Result<ConnectResponse<pb::GetMediaDownloadUrlResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.media_file_id)?;
    let m = require_media(&store, pid).await?;
    require_member(&store, &m.project_id, &auth).await?;
    let url = storage
        .presign_get(&m.storage_key, GET_TTL_SECS)
        .await
        .map_err(internal)?;
    Ok(ConnectResponse::new(pb::GetMediaDownloadUrlResponse {
        url,
        expires_in: GET_TTL_SECS,
    }))
}

/// Uploader/owner/admin: delete the object + row + all its task links.
async fn delete_media_file(
    Extension(store): StoreExt,
    Extension(storage): StorageExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::DeleteMediaFileRequest>,
) -> Result<ConnectResponse<pb::DeleteMediaFileResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.media_file_id)?;
    let m = require_media(&store, pid).await?;
    require_uploader_owner_or_admin(&store, &m, &auth).await?;
    storage.delete(&m.storage_key).await.map_err(internal)?;
    for lpid in link_pids_for_media(&store, &pid.to_string())
        .await
        .map_err(internal)?
    {
        store.delete(lpid).await.map_err(internal)?;
    }
    store.delete(pid).await.map_err(internal)?;
    record(
        &store,
        &m.project_id,
        &auth.id,
        EntityType::Media,
        &pid.to_string(),
        ActivityAction::Deleted,
        format!("deleted {}", m.file_name),
        vec![],
    )
    .await;
    Ok(ConnectResponse::new(pb::DeleteMediaFileResponse { ok: true }))
}

/// Member: link a file to a task in the same project (idempotent).
async fn link_task_media(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::LinkTaskMediaRequest>,
) -> Result<ConnectResponse<pb::LinkTaskMediaResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let mpid = parse_pid(&r.media_file_id)?;
    let m = require_media(&store, mpid).await?;
    require_member(&store, &m.project_id, &auth).await?;
    let tproj = task_project_id(&store, &r.task_id)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("task not found"))?;
    if tproj != m.project_id {
        return Err(ConnectError::new_invalid_argument(
            "task and media are in different projects",
        ));
    }
    if !link_exists(&store, &r.task_id, &r.media_file_id)
        .await
        .map_err(internal)?
    {
        store
            .create((TaskMediaLinkData {
                media_file_id: r.media_file_id.clone(),
                task_id: r.task_id.clone(),
                project_id: m.project_id.clone(),
            },))
            .await
            .map_err(internal)?;
    }
    Ok(ConnectResponse::new(pb::LinkTaskMediaResponse { ok: true }))
}

/// Member: remove a task↔file link (idempotent).
async fn unlink_task_media(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::UnlinkTaskMediaRequest>,
) -> Result<ConnectResponse<pb::UnlinkTaskMediaResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let mpid = parse_pid(&r.media_file_id)?;
    let m = require_media(&store, mpid).await?;
    require_member(&store, &m.project_id, &auth).await?;
    for lpid in link_pids_for_task_media(&store, &r.task_id, &r.media_file_id)
        .await
        .map_err(internal)?
    {
        store.delete(lpid).await.map_err(internal)?;
    }
    Ok(ConnectResponse::new(pb::UnlinkTaskMediaResponse { ok: true }))
}

/// Member: Ready files linked to a task.
async fn list_task_media(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListTaskMediaRequest>,
) -> Result<ConnectResponse<pb::ListMediaResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let tproj = task_project_id(&store, &r.task_id)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("task not found"))?;
    require_member(&store, &tproj, &auth).await?;
    let mut files = Vec::new();
    for mid in media_ids_for_task(&store, &r.task_id)
        .await
        .map_err(internal)?
    {
        if let Ok(mpid) = mid.parse::<i64>() {
            if let Some(m) = load_media(&store, mpid).await.map_err(internal)? {
                if m.status == MediaStatus::Ready {
                    files.push(to_proto(&m));
                }
            }
        }
    }
    Ok(ConnectResponse::new(pb::ListMediaResponse { files }))
}

/// MediaService router; injects the Store + Storage as request extensions.
pub fn media_router(store: Arc<Store>, storage: Arc<dyn Storage>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    MediaServiceBuilder::<()>::new()
        .create_media_upload::<_, (
            StoreExt,
            StorageExt,
            A,
            ConnectRequest<pb::CreateMediaUploadRequest>,
        )>(create_media_upload)
        .complete_media_upload::<_, (
            StoreExt,
            StorageExt,
            A,
            ConnectRequest<pb::CompleteMediaUploadRequest>,
        )>(complete_media_upload)
        .list_project_media::<_, (StoreExt, A, ConnectRequest<pb::ListProjectMediaRequest>)>(
            list_project_media,
        )
        .get_media_download_url::<_, (
            StoreExt,
            StorageExt,
            A,
            ConnectRequest<pb::GetMediaDownloadUrlRequest>,
        )>(get_media_download_url)
        .delete_media_file::<_, (
            StoreExt,
            StorageExt,
            A,
            ConnectRequest<pb::DeleteMediaFileRequest>,
        )>(delete_media_file)
        .link_task_media::<_, (StoreExt, A, ConnectRequest<pb::LinkTaskMediaRequest>)>(
            link_task_media,
        )
        .unlink_task_media::<_, (StoreExt, A, ConnectRequest<pb::UnlinkTaskMediaRequest>)>(
            unlink_task_media,
        )
        .list_task_media::<_, (StoreExt, A, ConnectRequest<pb::ListTaskMediaRequest>)>(
            list_task_media,
        )
        .build()
        .layer(Extension(store))
        .layer(Extension(storage))
}
