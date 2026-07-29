//! ActivityService: per-project / per-entity / recent-cross-project feeds. Read-only
//! (records are written internally by mutation handlers). Member-scoped.

use std::collections::HashSet;
use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::activity::EntityType;
use persistence::Store;

use super::record::{activity_for_entity, activity_for_project, activity_recent, to_proto, ActivityRecord};
use super::{internal, require_auth, require_member, StoreExt};
use crate::projects::record::member_project_ids;
use crate::sedjiwa::tasks::activity::v1 as pb;
use crate::sedjiwa::tasks::activity::v1::activity_service_connect::ActivityServiceBuilder;

const DEFAULT_PAGE_SIZE: u32 = 30;

fn paged(all: Vec<ActivityRecord>, page: u32, page_size: u32) -> pb::ListActivityResponse {
    let total = all.len() as u32;
    let page = page.max(1);
    let size = if page_size == 0 { DEFAULT_PAGE_SIZE } else { page_size };
    let start = ((page - 1) as usize).saturating_mul(size as usize);
    let activities = all
        .into_iter()
        .skip(start)
        .take(size as usize)
        .map(|a| to_proto(&a))
        .collect();
    pb::ListActivityResponse { activities, total }
}

async fn list_project_activity(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListProjectActivityRequest>,
) -> Result<ConnectResponse<pb::ListActivityResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    require_member(&store, &r.project_id, &auth).await?;
    let all = activity_for_project(&store, &r.project_id)
        .await
        .map_err(internal)?;
    Ok(ConnectResponse::new(paged(all, r.page, r.page_size)))
}

async fn list_entity_activity(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListEntityActivityRequest>,
) -> Result<ConnectResponse<pb::ListActivityResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let entity_type = EntityType::from_proto(r.entity_type)
        .ok_or_else(|| ConnectError::new_invalid_argument("invalid entity_type"))?;
    let all = activity_for_entity(&store, entity_type, &r.entity_id)
        .await
        .map_err(internal)?;
    // Project is derived from the activity rows themselves; member-check against it.
    if let Some(first) = all.first() {
        require_member(&store, &first.project_id, &auth).await?;
    }
    Ok(ConnectResponse::new(pb::ListActivityResponse {
        total: all.len() as u32,
        activities: all.iter().map(to_proto).collect(),
    }))
}

async fn list_recent_activity(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListRecentActivityRequest>,
) -> Result<ConnectResponse<pb::ListActivityResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    // Admin sees all; otherwise scope to the caller's member projects.
    let projects = if auth.is_admin() {
        None
    } else {
        let ids: HashSet<String> = member_project_ids(&store, &auth.id)
            .await
            .map_err(internal)?
            .into_iter()
            .collect();
        Some(ids)
    };
    let all = activity_recent(&store, projects).await.map_err(internal)?;
    Ok(ConnectResponse::new(paged(all, r.page, r.page_size)))
}

/// ActivityService router; injects the Store as a request extension.
pub fn activity_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    ActivityServiceBuilder::<()>::new()
        .list_project_activity::<_, (StoreExt, A, ConnectRequest<pb::ListProjectActivityRequest>)>(
            list_project_activity,
        )
        .list_entity_activity::<_, (StoreExt, A, ConnectRequest<pb::ListEntityActivityRequest>)>(
            list_entity_activity,
        )
        .list_recent_activity::<_, (StoreExt, A, ConnectRequest<pb::ListRecentActivityRequest>)>(
            list_recent_activity,
        )
        .build()
        .layer(Extension(store))
}
