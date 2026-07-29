//! LabelService: list + create/update/delete. All member-gated.

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::label::{color_ok, label_name_ok, LabelInfo};
use persistence::Store;

use super::record::{labels_for_project, load_label, to_proto, LabelRecord};
use super::{internal, parse_pid, require_auth, require_member, StoreExt};
use crate::sedjiwa::tasks::label::v1 as pb;
use crate::sedjiwa::tasks::label::v1::label_service_connect::LabelServiceBuilder;

async fn require_label(store: &Store, pid: i64) -> Result<LabelRecord, ConnectError> {
    load_label(store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("label not found"))
}

async fn list_labels(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListLabelsRequest>,
) -> Result<ConnectResponse<pb::ListLabelsResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    require_member(&store, &r.project_id, &auth).await?;
    let labels = labels_for_project(&store, &r.project_id)
        .await
        .map_err(internal)?;
    Ok(ConnectResponse::new(pb::ListLabelsResponse {
        labels: labels.iter().map(to_proto).collect(),
    }))
}

async fn create_label(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::CreateLabelRequest>,
) -> Result<ConnectResponse<pb::Label>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    require_member(&store, &r.project_id, &auth).await?;
    let name = r.name.trim();
    if !label_name_ok(name) {
        return Err(ConnectError::new_invalid_argument("name is required"));
    }
    if !color_ok(&r.color) {
        return Err(ConnectError::new_invalid_argument("color must be #RRGGBB"));
    }
    let pid = store
        .create((LabelInfo {
            project_id: r.project_id.clone(),
            name: name.to_string(),
            color: r.color.clone(),
        },))
        .await
        .map_err(internal)?;
    let l = require_label(&store, pid).await?;
    Ok(ConnectResponse::new(to_proto(&l)))
}

async fn update_label(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::UpdateLabelRequest>,
) -> Result<ConnectResponse<pb::Label>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let l = require_label(&store, pid).await?;
    require_member(&store, &l.project_id, &auth).await?;

    if let Some(name) = &r.name {
        if !label_name_ok(name) {
            return Err(ConnectError::new_invalid_argument("name cannot be blank"));
        }
    }
    if let Some(color) = &r.color {
        if !color_ok(color) {
            return Err(ConnectError::new_invalid_argument("color must be #RRGGBB"));
        }
    }
    let name = r.name.map(|n| n.trim().to_string());
    let color = r.color;
    store
        .update(pid, move |w, e| {
            if let Some(cur) = w.get::<LabelInfo>(e).cloned() {
                w.remove::<LabelInfo>(e);
                w.insert(
                    e,
                    LabelInfo {
                        project_id: cur.project_id,
                        name: name.unwrap_or(cur.name),
                        color: color.unwrap_or(cur.color),
                    },
                );
            }
        })
        .await
        .map_err(internal)?;
    let l = require_label(&store, pid).await?;
    Ok(ConnectResponse::new(to_proto(&l)))
}

/// Tolerant delete: removes only the label entity. Tasks keep dangling
/// `label_ids` (frontend filters).
async fn delete_label(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::DeleteLabelRequest>,
) -> Result<ConnectResponse<pb::DeleteLabelResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let l = require_label(&store, pid).await?;
    require_member(&store, &l.project_id, &auth).await?;
    store.delete(pid).await.map_err(internal)?;
    Ok(ConnectResponse::new(pb::DeleteLabelResponse { ok: true }))
}

/// LabelService router; injects the Store as a request extension.
pub fn label_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    LabelServiceBuilder::<()>::new()
        .list_labels::<_, (StoreExt, A, ConnectRequest<pb::ListLabelsRequest>)>(list_labels)
        .create_label::<_, (StoreExt, A, ConnectRequest<pb::CreateLabelRequest>)>(create_label)
        .update_label::<_, (StoreExt, A, ConnectRequest<pb::UpdateLabelRequest>)>(update_label)
        .delete_label::<_, (StoreExt, A, ConnectRequest<pb::DeleteLabelRequest>)>(delete_label)
        .build()
        .layer(Extension(store))
}
