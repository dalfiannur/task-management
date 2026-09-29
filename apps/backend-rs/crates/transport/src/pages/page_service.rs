//! PageService: list/get + create/update/delete/reorder. All member-gated.

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::page::DEFAULT_PAGE_TITLE;
use persistence::Store;

use super::record::{self as page_record, load_page, pages_for_project, to_proto, PageRecord};
use super::{internal, parse_pid, require_auth, require_member, StoreExt};
use crate::activity::record;
use crate::search::{deindex, index, kind, page_doc};
use domain::activity::{ActivityAction, EntityType};
use crate::sedjiwa::tasks::page::v1 as pb;
use crate::sedjiwa::tasks::page::v1::page_service_connect::PageServiceBuilder;

fn now_iso() -> String {
    use time::format_description::well_known::Rfc3339;
    time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}

fn list_response(pages: &[PageRecord]) -> pb::ListPagesResponse {
    pb::ListPagesResponse {
        pages: pages.iter().map(to_proto).collect(),
    }
}

async fn require_page(store: &Store, pid: i64) -> Result<PageRecord, ConnectError> {
    load_page(store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("page not found"))
}

async fn list_pages(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListPagesRequest>,
) -> Result<ConnectResponse<pb::ListPagesResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    require_member(&store, &r.project_id, &auth).await?;
    let pages = pages_for_project(&store, &r.project_id)
        .await
        .map_err(internal)?;
    Ok(ConnectResponse::new(list_response(&pages)))
}

async fn get_page(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::GetPageRequest>,
) -> Result<ConnectResponse<pb::Page>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let p = require_page(&store, pid).await?;
    require_member(&store, &p.project_id, &auth).await?;
    Ok(ConnectResponse::new(to_proto(&p)))
}

async fn create_page(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::CreatePageRequest>,
) -> Result<ConnectResponse<pb::Page>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    require_member(&store, &r.project_id, &auth).await?;

    let title = r
        .title
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| DEFAULT_PAGE_TITLE.to_string());
    let pid = page_record::create_page(
        &store,
        &r.project_id,
        &title,
        &r.icon.unwrap_or_default(),
        &domain::sanitize::clean_html(&r.content.unwrap_or_default()),
        &auth.id,
        &now_iso(),
    )
    .await
    .map_err(internal)?;
    let p = require_page(&store, pid).await?;
    record(
        &store,
        &p.project_id,
        &auth.id,
        EntityType::Page,
        &pid.to_string(),
        ActivityAction::Created,
        format!("created page '{}'", p.title),
        vec![],
    )
    .await;
    index(&store, page_doc(&pid.to_string(), &p.project_id, &p.title, &p.content)).await;
    Ok(ConnectResponse::new(to_proto(&p)))
}

async fn update_page(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::UpdatePageRequest>,
) -> Result<ConnectResponse<pb::Page>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let p = require_page(&store, pid).await?;
    require_member(&store, &p.project_id, &auth).await?;

    page_record::update_page(
        &store,
        pid,
        &r.title.unwrap_or_else(|| p.title.clone()),
        &r.icon.unwrap_or_else(|| p.icon.clone()),
        &domain::sanitize::clean_html(&r.content.unwrap_or_else(|| p.content.clone())),
        &auth.id,
        &now_iso(),
    )
    .await
    .map_err(internal)?;
    let p = require_page(&store, pid).await?;
    record(
        &store,
        &p.project_id,
        &auth.id,
        EntityType::Page,
        &pid.to_string(),
        ActivityAction::Updated,
        format!("updated page '{}'", p.title),
        vec![],
    )
    .await;
    index(&store, page_doc(&pid.to_string(), &p.project_id, &p.title, &p.content)).await;
    Ok(ConnectResponse::new(to_proto(&p)))
}

async fn delete_page(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::DeletePageRequest>,
) -> Result<ConnectResponse<pb::DeletePageResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let p = require_page(&store, pid).await?;
    require_member(&store, &p.project_id, &auth).await?;
    page_record::delete_page(&store, pid).await.map_err(internal)?;
    record(
        &store,
        &p.project_id,
        &auth.id,
        EntityType::Page,
        &pid.to_string(),
        ActivityAction::Deleted,
        format!("deleted page '{}'", p.title),
        vec![],
    )
    .await;
    deindex(&store, kind::PAGE, &pid.to_string()).await;
    Ok(ConnectResponse::new(pb::DeletePageResponse { ok: true }))
}

async fn reorder_pages(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ReorderPagesRequest>,
) -> Result<ConnectResponse<pb::ListPagesResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    require_member(&store, &r.project_id, &auth).await?;
    // Only pages of this project are reordered.
    page_record::reorder_pages(&store, &r.project_id, &r.page_ids)
        .await
        .map_err(internal)?;
    let pages = pages_for_project(&store, &r.project_id)
        .await
        .map_err(internal)?;
    Ok(ConnectResponse::new(list_response(&pages)))
}

/// PageService router; injects the Store as a request extension.
pub fn page_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    PageServiceBuilder::<()>::new()
        .list_pages::<_, (StoreExt, A, ConnectRequest<pb::ListPagesRequest>)>(list_pages)
        .get_page::<_, (StoreExt, A, ConnectRequest<pb::GetPageRequest>)>(get_page)
        .create_page::<_, (StoreExt, A, ConnectRequest<pb::CreatePageRequest>)>(create_page)
        .update_page::<_, (StoreExt, A, ConnectRequest<pb::UpdatePageRequest>)>(update_page)
        .delete_page::<_, (StoreExt, A, ConnectRequest<pb::DeletePageRequest>)>(delete_page)
        .reorder_pages::<_, (StoreExt, A, ConnectRequest<pb::ReorderPagesRequest>)>(reorder_pages)
        .build()
        .layer(Extension(store))
}
