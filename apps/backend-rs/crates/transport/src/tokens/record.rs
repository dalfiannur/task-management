//! Pembacaan PAT dari store. Satu `TokenRecord` pipih agar handler dan crate
//! `mcp` tidak perlu menyentuh komponen ECS satu per satu.

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

/// Token milik satu user, terbaru dulu.
pub async fn tokens_for_owner(store: &Store, user_id: &str) -> anyhow::Result<Vec<TokenRecord>> {
    let owner = user_id.to_string();
    let mut v = store
        .query::<TokenOwner, TokenRecord>(None, move |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| read(world, *e, *pid))
                .filter(|t| t.user_id == owner)
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

/// Lookup by digest — jalur panas setiap tool call MCP.
///
/// Interpolasi ke predikat SQL aman di sini: `hash` selalu digest hex 64
/// karakter hasil `domain::token::hash_token`, bukan teks mentah dari user
/// (pemanggil wajib menyaring lewat `looks_like_token` lebih dulu).
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
