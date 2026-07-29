//! MyTasksService: assigned-to-me / created-by-me / involving-me (cross-project).

use std::collections::HashSet;
use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::comment::CommentInfo;
use domain::task::{TaskPriority, TaskStatus};
use persistence::Store;

use super::context::Context;
use super::{internal, require_auth, StoreExt};
use crate::sedjiwa::tasks::dashboard::v1 as pb;
use crate::sedjiwa::tasks::dashboard::v1::my_tasks_service_connect::MyTasksServiceBuilder;
use crate::work::task_record::TaskRecord;

const DEFAULT_PAGE_SIZE: u32 = 20;

/// Filter by status/priority + paginate + enrich.
fn respond(ctx: &Context, tasks: Vec<&TaskRecord>, r: &pb::MyTasksRequest) -> pb::MyTasksResponse {
    let want_status = r.status.and_then(TaskStatus::from_proto);
    let want_priority = r.priority.and_then(TaskPriority::from_proto);
    let mut filtered: Vec<&TaskRecord> = tasks
        .into_iter()
        .filter(|t| want_status.is_none_or(|s| t.status == s))
        .filter(|t| want_priority.is_none_or(|p| t.priority == p))
        .collect();
    filtered.sort_by_key(|t| t.pid);

    let total = filtered.len() as u32;
    let page = r.page.max(1);
    let size = if r.page_size == 0 {
        DEFAULT_PAGE_SIZE
    } else {
        r.page_size
    };
    let start = ((page - 1) as usize).saturating_mul(size as usize);
    let items = filtered
        .into_iter()
        .skip(start)
        .take(size as usize)
        .map(|t| ctx.to_mytask(t))
        .collect();
    pb::MyTasksResponse { items, total }
}

async fn list_assigned_to_me(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::MyTasksRequest>,
) -> Result<ConnectResponse<pb::MyTasksResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let ctx = Context::load(&store, &auth).await.map_err(internal)?;
    let tasks = ctx
        .scoped_tasks()
        .into_iter()
        .filter(|t| t.assignee_ids.iter().any(|a| a == &auth.id))
        .collect();
    Ok(ConnectResponse::new(respond(&ctx, tasks, &r)))
}

async fn list_created_by_me(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::MyTasksRequest>,
) -> Result<ConnectResponse<pb::MyTasksResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let ctx = Context::load(&store, &auth).await.map_err(internal)?;
    let tasks = ctx
        .scoped_tasks()
        .into_iter()
        .filter(|t| t.created_by == auth.id)
        .collect();
    Ok(ConnectResponse::new(respond(&ctx, tasks, &r)))
}

async fn list_involving_me(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::MyTasksRequest>,
) -> Result<ConnectResponse<pb::MyTasksResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    // Task ids where I authored a comment or was mentioned.
    let me = auth.id.clone();
    let involved: HashSet<String> = store
        .query::<CommentInfo, String>(None, move |world, pairs| {
            pairs
                .iter()
                .filter_map(|(_, e)| world.get::<CommentInfo>(*e))
                .filter(|c| c.author_id == me || c.mentioned_user_ids.contains(&me))
                .map(|c| c.task_id.clone())
                .collect()
        })
        .await
        .map_err(internal)?
        .into_iter()
        .collect();
    let ctx = Context::load(&store, &auth).await.map_err(internal)?;
    let tasks = ctx
        .scoped_tasks()
        .into_iter()
        .filter(|t| involved.contains(&t.pid.to_string()))
        .collect();
    Ok(ConnectResponse::new(respond(&ctx, tasks, &r)))
}

/// MyTasksService router; injects the Store as a request extension.
pub fn mytasks_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    MyTasksServiceBuilder::<()>::new()
        .list_assigned_to_me::<_, (StoreExt, A, ConnectRequest<pb::MyTasksRequest>)>(
            list_assigned_to_me,
        )
        .list_created_by_me::<_, (StoreExt, A, ConnectRequest<pb::MyTasksRequest>)>(
            list_created_by_me,
        )
        .list_involving_me::<_, (StoreExt, A, ConnectRequest<pb::MyTasksRequest>)>(list_involving_me)
        .build()
        .layer(Extension(store))
}
