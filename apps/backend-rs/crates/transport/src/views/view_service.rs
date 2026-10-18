//! SavedViewService: list + create/update/delete. Member-gated; a view is
//! edited by its owner, and a shared one also by the project owner or an
//! admin. Only the owner (or an admin) changes who it is shared with.

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::view::{normalize_query, view_name_ok, ViewLayout};
use persistence::Store;

use super::record::{self as view_record, load_view, to_proto, views_visible_to, NewView, ViewRecord};
use crate::projects::record::load_project;
use crate::sedjiwa::tasks::view::v1 as pb;
use crate::sedjiwa::tasks::view::v1::saved_view_service_connect::SavedViewServiceBuilder;
use crate::work::{internal, parse_pid, require_auth, require_member, StoreExt};

fn now_iso() -> String {
    use time::format_description::well_known::Rfc3339;
    time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}

/// The view, if `auth` may see it: a member of its project, and its owner
/// unless it is shared. Someone else's personal view reads as not found.
async fn visible_view(store: &Store, id: &str, auth: &AuthUser) -> Result<ViewRecord, ConnectError> {
    let not_found = || ConnectError::new_not_found("view not found");
    let v = load_view(store, parse_pid(id)?)
        .await
        .map_err(internal)?
        .ok_or_else(not_found)?;
    require_member(store, &v.project_id, auth).await?;
    if v.shared || v.owner_id == auth.id || auth.is_admin() {
        Ok(v)
    } else {
        Err(not_found())
    }
}

/// Owner, admin, or — for a shared view — the project's owner.
async fn may_edit(store: &Store, v: &ViewRecord, auth: &AuthUser) -> Result<bool, ConnectError> {
    if v.owner_id == auth.id || auth.is_admin() {
        return Ok(true);
    }
    if !v.shared {
        return Ok(false);
    }
    let pid = parse_pid(&v.project_id)?;
    Ok(load_project(store, pid)
        .await
        .map_err(internal)?
        .is_some_and(|p| p.owner_id == auth.id))
}

fn clean_name(name: &str) -> Result<String, ConnectError> {
    if view_name_ok(name) {
        Ok(name.trim().to_string())
    } else {
        Err(ConnectError::new_invalid_argument(
            "name is required (at most 80 characters)",
        ))
    }
}

fn clean_query(query: &str) -> Result<String, ConnectError> {
    normalize_query(query).ok_or_else(|| ConnectError::new_invalid_argument("query is too long"))
}

async fn list_saved_views(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListSavedViewsRequest>,
) -> Result<ConnectResponse<pb::ListSavedViewsResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    require_member(&store, &r.project_id, &auth).await?;
    let views = views_visible_to(&store, &r.project_id, &auth.id)
        .await
        .map_err(internal)?;
    Ok(ConnectResponse::new(pb::ListSavedViewsResponse {
        views: views.iter().map(to_proto).collect(),
    }))
}

async fn create_saved_view(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::CreateSavedViewRequest>,
) -> Result<ConnectResponse<pb::SavedView>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    require_member(&store, &r.project_id, &auth).await?;
    let name = clean_name(&r.name)?;
    let query = clean_query(&r.query)?;
    let layout = ViewLayout::from_proto(r.layout).unwrap_or(ViewLayout::List);
    let pid = view_record::create_view(
        &store,
        NewView {
            project_id: &r.project_id,
            owner_id: &auth.id,
            name: &name,
            query: &query,
            layout,
            shared: r.shared,
            created_at: &now_iso(),
        },
    )
    .await
    .map_err(internal)?;
    let v = visible_view(&store, &pid.to_string(), &auth).await?;
    Ok(ConnectResponse::new(to_proto(&v)))
}

async fn update_saved_view(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::UpdateSavedViewRequest>,
) -> Result<ConnectResponse<pb::SavedView>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let v = visible_view(&store, &r.id, &auth).await?;
    if !may_edit(&store, &v, &auth).await? {
        return Err(ConnectError::new_permission_denied(
            "only the view's owner can change it",
        ));
    }
    // Sharing is the owner's call: a project owner editing a shared view may
    // not make it someone else's private view.
    if r.shared.is_some_and(|s| s != v.shared) && v.owner_id != auth.id && !auth.is_admin() {
        return Err(ConnectError::new_permission_denied(
            "only the view's owner can change who it is shared with",
        ));
    }
    let name = r.name.as_deref().map(clean_name).transpose()?;
    let query = r.query.as_deref().map(clean_query).transpose()?;
    let layout = match r.layout {
        Some(code) => Some(
            ViewLayout::from_proto(code)
                .ok_or_else(|| ConnectError::new_invalid_argument("invalid layout"))?,
        ),
        None => None,
    };
    view_record::update_view(&store, v.pid, name, query, layout, r.shared)
        .await
        .map_err(internal)?;
    let v = visible_view(&store, &r.id, &auth).await?;
    Ok(ConnectResponse::new(to_proto(&v)))
}

async fn delete_saved_view(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::DeleteSavedViewRequest>,
) -> Result<ConnectResponse<pb::DeleteSavedViewResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let v = visible_view(&store, &r.id, &auth).await?;
    if !may_edit(&store, &v, &auth).await? {
        return Err(ConnectError::new_permission_denied(
            "only the view's owner can delete it",
        ));
    }
    view_record::delete_view(&store, v.pid).await.map_err(internal)?;
    Ok(ConnectResponse::new(pb::DeleteSavedViewResponse { ok: true }))
}

/// SavedViewService router; injects the Store as a request extension.
pub fn view_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    SavedViewServiceBuilder::<()>::new()
        .list_saved_views::<_, (StoreExt, A, ConnectRequest<pb::ListSavedViewsRequest>)>(list_saved_views)
        .create_saved_view::<_, (StoreExt, A, ConnectRequest<pb::CreateSavedViewRequest>)>(create_saved_view)
        .update_saved_view::<_, (StoreExt, A, ConnectRequest<pb::UpdateSavedViewRequest>)>(update_saved_view)
        .delete_saved_view::<_, (StoreExt, A, ConnectRequest<pb::DeleteSavedViewRequest>)>(delete_saved_view)
        .build()
        .layer(Extension(store))
}
