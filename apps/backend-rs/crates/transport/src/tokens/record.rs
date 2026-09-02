//! Reading PATs from the store. A single flat `TokenRecord` so handlers and the
//! `mcp` crate don't have to touch ECS components one by one.

use arke::{Entity, World};
use domain::token::{TokenInfo, TokenOwner, TokenSecret, TokenUsage};
use persistence::Store;

#[derive(Debug, Clone)]
pub struct TokenRecord {
    pub pid: i64,
    pub user_id: String,
    pub name: String,
    pub preview: String,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub last_used_at: Option<String>,
}

fn read(world: &World, e: Entity, pid: i64) -> Option<TokenRecord> {
    let owner = world.get::<TokenOwner>(e)?;
    let info = world.get::<TokenInfo>(e)?;
    let secret = world.get::<TokenSecret>(e)?;
    Some(TokenRecord {
        pid,
        user_id: owner.user_id.clone(),
        name: info.name.clone(),
        preview: secret.preview.clone(),
        created_at: info.created_at.clone(),
        expires_at: info.expires_at.clone(),
        last_used_at: world
            .get::<TokenUsage>(e)
            .and_then(|u| u.last_used_at.clone()),
    })
}

/// One user's tokens, newest first.
///
/// Filter in SQL, not in Rust. `query(None, ..)` would hydrate every token
/// belonging to *every* user before the ownership filter ever runs — and
/// hydrating one pid costs one existence query plus one query per registered
/// component type. That lesson was already paid for once and written up in
/// full, numbers included, at `activity::record::activity_for_project`;
/// `TokenOwner.user_id` is indexed exactly for this query.
pub async fn tokens_for_owner(store: &Store, user_id: &str) -> anyhow::Result<Vec<TokenRecord>> {
    if !crate::sql::safe_sql_id(user_id) {
        return Ok(Vec::new());
    }
    let pred = format!("user_id = '{user_id}'");
    let mut v = store
        .query::<TokenOwner, TokenRecord>(Some(&pred), |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| read(world, *e, *pid))
                .collect()
        })
        .await?;
    v.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.pid.cmp(&a.pid)));
    Ok(v)
}

pub async fn load_token(store: &Store, pid: i64) -> anyhow::Result<Option<TokenRecord>> {
    let pred = format!("pid = {pid}");
    let mut v = store
        .query::<TokenSecret, TokenRecord>(Some(&pred), |world, pairs| {
            pairs
                .iter()
                .filter_map(|(p, e)| read(world, *e, *p))
                .collect()
        })
        .await?;
    Ok(v.pop())
}

/// Lookup by digest — the hot path for every MCP tool call.
///
/// Interpolating into the SQL predicate is safe here: `hash` is always a
/// 64-character hex digest produced by `domain::token::hash_token`, never raw
/// user text (callers must screen through `looks_like_token` first).
pub async fn find_by_hash(store: &Store, hash: &str) -> anyhow::Result<Option<TokenRecord>> {
    let pred = format!("hash = '{hash}'");
    let mut v = store
        .query::<TokenSecret, TokenRecord>(Some(&pred), |world, pairs| {
            pairs
                .iter()
                .filter_map(|(p, e)| read(world, *e, *p))
                .collect()
        })
        .await?;
    Ok(v.pop())
}
