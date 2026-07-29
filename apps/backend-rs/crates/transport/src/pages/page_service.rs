//! PageService: list/get + create/update/delete/reorder. All member-gated.

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::page::{PageAudit, PageInfo, DEFAULT_PAGE_TITLE};
use persistence::Store;

use super::record::{load_page, pages_for_project, to_proto, PageRecord};
use super::{internal, parse_pid, require_auth, require_member, StoreExt};
use crate::activity::record;
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
    let existing = pages_for_project(&store, &r.project_id)
        .await
        .map_err(internal)?;
    let order = existing.iter().map(|p| p.order).max().map(|m| m + 1).unwrap_or(0);
    let now = now_iso();

    let pid = store
        .create((
            PageInfo {
                project_id: r.project_id.clone(),
                title,
                icon: r.icon.unwrap_or_default(),
                content: r.content.unwrap_or_default(),
                sort_order: order,
            },
            PageAudit {
                created_by: auth.id.clone(),
                last_edited_by: auth.id.clone(),
                created_at: now.clone(),
                updated_at: now,
            },
        ))
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

    let info = PageInfo {
        project_id: p.project_id.clone(),
        title: r.title.unwrap_or_else(|| p.title.clone()),
        icon: r.icon.unwrap_or_else(|| p.icon.clone()),
        content: r.content.unwrap_or_else(|| p.content.clone()),
        sort_order: p.order,
    };
    let audit = PageAudit {
        created_by: p.created_by.clone(),
        last_edited_by: auth.id.clone(),
        created_at: p.created_at.clone(),
        updated_at: now_iso(),
    };
    store
        .update(pid, move |w, e| {
            w.remove::<PageInfo>(e);
            w.insert(e, info);
            w.remove::<PageAudit>(e);
            w.insert(e, audit);
        })
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
    store.delete(pid).await.map_err(internal)?;
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
    for (idx, page_id) in r.page_ids.iter().enumerate() {
        let Ok(ppid) = page_id.parse::<i64>() else {
            continue;
        };
        match load_page(&store, ppid).await.map_err(internal)? {
            Some(p) if p.project_id == r.project_id => {
                let order = idx as i32;
                let info = PageInfo {
                    project_id: p.project_id.clone(),
                    title: p.title.clone(),
                    icon: p.icon.clone(),
                    content: p.content.clone(),
                    sort_order: order,
                };
                store
                    .update(ppid, move |w, e| {
                        w.remove::<PageInfo>(e);
                        w.insert(e, info);
                    })
                    .await
                    .map_err(internal)?;
            }
            _ => continue,
        }
    }
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
