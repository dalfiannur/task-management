//! SearchService: one RPC. The store does matching, permission filtering,
//! ranking, snippets, and limiting in a single statement; this handler only
//! resolves the caller's scope going in and enriches display fields coming out.

use std::collections::HashMap;
use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use persistence::Store;

use super::indexer::kind;
use crate::comments::record::load_comment;
use crate::projects::record::{load_all_projects, member_project_ids};
use crate::sedjiwa::tasks::search::v1 as pb;
use crate::sedjiwa::tasks::search::v1::search_service_connect::SearchServiceBuilder;

const DEFAULT_LIMIT: u32 = 20;
const MAX_LIMIT: u32 = 50;

fn internal(e: impl std::fmt::Display) -> ConnectError {
    ConnectError::new_internal(e.to_string())
}

fn kind_to_str(k: i32) -> Option<&'static str> {
    match pb::SearchKind::try_from(k).ok()? {
        pb::SearchKind::Task => Some(kind::TASK),
        pb::SearchKind::Page => Some(kind::PAGE),
        pb::SearchKind::Comment => Some(kind::COMMENT),
        pb::SearchKind::Project => Some(kind::PROJECT),
        pb::SearchKind::User => Some(kind::USER),
        pb::SearchKind::Unspecified => None,
    }
}

fn str_to_kind(s: &str) -> pb::SearchKind {
    match s {
        kind::TASK => pb::SearchKind::Task,
        kind::PAGE => pb::SearchKind::Page,
        kind::COMMENT => pb::SearchKind::Comment,
        kind::PROJECT => pb::SearchKind::Project,
        kind::USER => pb::SearchKind::User,
        _ => pb::SearchKind::Unspecified,
    }
}

pub async fn search_core(
    store: &Store,
    auth: &AuthUser,
    r: pb::SearchRequest,
) -> Result<pb::SearchResponse, ConnectError> {
    let q = r.q.trim().to_string();
    if q.is_empty() {
        return Ok(pb::SearchResponse { results: vec![] });
    }

    let is_admin = auth.is_admin();
    let project_ids = if is_admin {
        vec![]
    } else {
        member_project_ids(store, &auth.id).await.map_err(internal)?
    };
    let kinds: Vec<String> = r
        .kinds
        .iter()
        .filter_map(|k| kind_to_str(*k))
        .map(|s| s.to_string())
        .collect();
    let limit = match r.limit {
        0 => DEFAULT_LIMIT,
        n => n.min(MAX_LIMIT),
    } as i64;

    let rows = store
        .search(&q, is_admin, &project_ids, &kinds, &r.assignee_ids, limit)
        .await
        .map_err(internal)?;

    // Project names are resolved here, not stored, so a renamed project never
    // shows a stale name in a result subtitle.
    let names: HashMap<String, String> = load_all_projects(store)
        .await
        .map_err(internal)?
        .into_iter()
        .map(|p| (p.pid.to_string(), p.name))
        .collect();

    let mut results = Vec::with_capacity(rows.len());
    for row in rows {
        // A comment result needs its parent task to build a destination URL.
        // Bounded by `limit`, so this is at most 50 lookups on the widest page.
        let task_id = if row.kind == kind::COMMENT {
            match row.entity_id.parse::<i64>().ok() {
                Some(p) => load_comment(store, p)
                    .await
                    .map_err(internal)?
                    .map(|c| c.task_id),
                None => None,
            }
        } else {
            None
        };
        let project_name = row
            .project_id
            .as_ref()
            .and_then(|id| names.get(id).cloned());
        results.push(pb::SearchResult {
            kind: str_to_kind(&row.kind).into(),
            id: row.entity_id,
            title: row.title,
            snippet: row.snippet,
            project_id: row.project_id,
            project_name,
            task_id,
            score: row.score,
            parent_id: row.parent_id,
            parent_title: row.parent_title,
        });
    }

    Ok(pb::SearchResponse { results })
}

async fn search(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::SearchRequest>,
) -> Result<ConnectResponse<pb::SearchResponse>, ConnectError> {
    let auth = user
        .map(|Extension(u)| u)
        .ok_or_else(|| ConnectError::new_unauthenticated("authentication required"))?;
    let ConnectRequest(r) = req;
    Ok(ConnectResponse::new(search_core(&store, &auth, r).await?))
}

/// SearchService router; injects the Store as a request extension.
pub fn search_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    SearchServiceBuilder::<()>::new()
        .search::<_, (Extension<Arc<Store>>, A, ConnectRequest<pb::SearchRequest>)>(search)
        .build()
        .layer(Extension(store))
}
