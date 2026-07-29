//! CommentService: list (paginated) + create/update/delete. Member-gated;
//! author-only edit; author/owner/admin delete. Mentions filtered to members.

use std::collections::HashSet;
use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::comment::{content_ok, CommentInfo};
use persistence::Store;

use super::record::{comments_for_task, load_comment, to_proto, CommentRecord};
use super::{
    internal, parse_pid, require_auth, require_author, require_author_owner_or_admin,
    require_member, StoreExt,
};
use crate::projects::record::project_member_ids;
use crate::sedjiwa::tasks::comment::v1 as pb;
use crate::sedjiwa::tasks::comment::v1::comment_service_connect::CommentServiceBuilder;
use crate::work::task_project_id;

const DEFAULT_PAGE_SIZE: u32 = 50;

fn now_iso() -> String {
    use time::format_description::well_known::Rfc3339;
    time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}

/// Resolve a task's project, or `not_found`.
async fn task_project(store: &Store, task_id: &str) -> Result<String, ConnectError> {
    task_project_id(store, task_id)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("task not found"))
}

async fn require_comment(store: &Store, pid: i64) -> Result<CommentRecord, ConnectError> {
    load_comment(store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("comment not found"))
}

/// Keep only mentions that are members of `project_id` (deduped). Non-members
/// are silently dropped (spec §5).
async fn filter_mentions(
    store: &Store,
    project_id: &str,
    mentioned: Vec<String>,
) -> Result<Vec<String>, ConnectError> {
    if mentioned.is_empty() {
        return Ok(Vec::new());
    }
    let members: HashSet<String> = project_member_ids(store, project_id)
        .await
        .map_err(internal)?
        .into_iter()
        .collect();
    let mut seen = HashSet::new();
    Ok(mentioned
        .into_iter()
        .filter(|m| members.contains(m) && seen.insert(m.clone()))
        .collect())
}

async fn list_comments(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListCommentsRequest>,
) -> Result<ConnectResponse<pb::ListCommentsResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let project_id = task_project(&store, &r.task_id).await?;
    require_member(&store, &project_id, &auth).await?;

    let all = comments_for_task(&store, &r.task_id)
        .await
        .map_err(internal)?;
    let total = all.len() as u32;
    let page = r.page.max(1);
    let page_size = if r.page_size == 0 {
        DEFAULT_PAGE_SIZE
    } else {
        r.page_size
    };
    let start = ((page - 1) as usize).saturating_mul(page_size as usize);
    let comments = all
        .into_iter()
        .skip(start)
        .take(page_size as usize)
        .map(|c| to_proto(&c))
        .collect();
    Ok(ConnectResponse::new(pb::ListCommentsResponse {
        comments,
        total,
    }))
}

async fn create_comment(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::CreateCommentRequest>,
) -> Result<ConnectResponse<pb::Comment>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let project_id = task_project(&store, &r.task_id).await?;
    require_member(&store, &project_id, &auth).await?;
    let content = r.content.trim();
    if !content_ok(content) {
        return Err(ConnectError::new_invalid_argument("content is required"));
    }
    let mentions = filter_mentions(&store, &project_id, r.mentioned_user_ids).await?;
    let now = now_iso();
    let pid = store
        .create((CommentInfo {
            task_id: r.task_id.clone(),
            author_id: auth.id.clone(),
            content: content.to_string(),
            mentioned_user_ids: mentions,
            created_at: now.clone(),
            updated_at: now,
        },))
        .await
        .map_err(internal)?;
    // notify(new mentions except self) — deferred: Notifications flow not built.
    let c = require_comment(&store, pid).await?;
    Ok(ConnectResponse::new(to_proto(&c)))
}

async fn update_comment(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::UpdateCommentRequest>,
) -> Result<ConnectResponse<pb::Comment>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let c = require_comment(&store, pid).await?;
    require_author(&c, &auth)?;
    let content = r.content.trim();
    if !content_ok(content) {
        return Err(ConnectError::new_invalid_argument("content is required"));
    }
    let project_id = task_project(&store, &c.task_id).await?;
    let mentions = filter_mentions(&store, &project_id, r.mentioned_user_ids).await?;

    let info = CommentInfo {
        task_id: c.task_id.clone(),
        author_id: c.author_id.clone(),
        content: content.to_string(),
        mentioned_user_ids: mentions,
        created_at: c.created_at.clone(),
        updated_at: now_iso(),
    };
    store
        .update(pid, move |w, e| {
            w.remove::<CommentInfo>(e);
            w.insert(e, info);
        })
        .await
        .map_err(internal)?;
    // notify(mentions added vs before) — deferred: Notifications flow not built.
    let c = require_comment(&store, pid).await?;
    Ok(ConnectResponse::new(to_proto(&c)))
}

async fn delete_comment(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::DeleteCommentRequest>,
) -> Result<ConnectResponse<pb::DeleteCommentResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let c = require_comment(&store, pid).await?;
    let project_id = task_project(&store, &c.task_id).await?;
    require_author_owner_or_admin(&store, &c, &project_id, &auth).await?;
    store.delete(pid).await.map_err(internal)?;
    Ok(ConnectResponse::new(pb::DeleteCommentResponse { ok: true }))
}

/// CommentService router; injects the Store as a request extension.
pub fn comment_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    CommentServiceBuilder::<()>::new()
        .list_comments::<_, (StoreExt, A, ConnectRequest<pb::ListCommentsRequest>)>(list_comments)
        .create_comment::<_, (StoreExt, A, ConnectRequest<pb::CreateCommentRequest>)>(create_comment)
        .update_comment::<_, (StoreExt, A, ConnectRequest<pb::UpdateCommentRequest>)>(update_comment)
        .delete_comment::<_, (StoreExt, A, ConnectRequest<pb::DeleteCommentRequest>)>(delete_comment)
        .build()
        .layer(Extension(store))
}
