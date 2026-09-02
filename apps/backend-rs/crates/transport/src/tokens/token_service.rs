//! AccessTokenService: issue / list / revoke PATs. Entirely self-scoped —
//! the owner is always taken from the JWT, so even an admin can't touch
//! someone else's token. The plaintext exists only once, in the CreateToken
//! response.

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::token::{
    generate_token, hash_token, is_expired, now_iso, preview_of, TokenInfo, TokenOwner,
    TokenSecret, TokenUsage,
};
use persistence::Store;

use super::record::{load_token, tokens_for_owner, TokenRecord};
use crate::sedjiwa::tasks::token::v1 as pb;
use crate::sedjiwa::tasks::token::v1::access_token_service_connect::AccessTokenServiceBuilder;

fn internal(e: impl std::fmt::Display) -> ConnectError {
    ConnectError::new_internal(e.to_string())
}

fn require_auth(user: Option<Extension<AuthUser>>) -> Result<AuthUser, ConnectError> {
    user.map(|Extension(u)| u)
        .ok_or_else(|| ConnectError::new_unauthenticated("authentication required"))
}

/// A deliberate upper bound. `OffsetDateTime + Duration` **panics** when the
/// result falls outside the representable range, and `expires_in_days` arrives
/// raw from the client as a `uint32` — without this bound a single request with
/// a huge number crashes the handler instead of getting an `invalid_argument`.
pub(crate) const MAX_EXPIRY_DAYS: u32 = 3650; // 10 years

/// `expires_in_days` → `expires_at` RFC3339. 0 = never expires.
fn expiry_from_days(days: u32) -> Option<String> {
    if days == 0 {
        return None;
    }
    let at = time::OffsetDateTime::now_utc() + time::Duration::days(days as i64);
    // Same precision fix as `now_iso`, applied to a non-"now" instant — see
    // `domain::token::pinned_rfc3339`.
    Some(domain::token::pinned_rfc3339(at))
}

fn to_proto(t: &TokenRecord, now: &str) -> pb::AccessToken {
    pb::AccessToken {
        id: t.pid.to_string(),
        name: t.name.clone(),
        preview: t.preview.clone(),
        created_at: t.created_at.clone(),
        expires_at: t.expires_at.clone(),
        last_used_at: t.last_used_at.clone(),
        expired: is_expired(t.expires_at.as_deref(), now),
    }
}

async fn create_token(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::CreateTokenRequest>,
) -> Result<ConnectResponse<pb::CreateTokenResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let name = r.name.trim();
    if name.is_empty() || name.chars().count() > 64 {
        return Err(ConnectError::new_invalid_argument(
            "name is required (max 64 characters)",
        ));
    }
    if r.expires_in_days > MAX_EXPIRY_DAYS {
        return Err(ConnectError::new_invalid_argument(
            "expires_in_days must be 3650 or less",
        ));
    }
    let plaintext = generate_token();
    let now = now_iso();
    let pid = store
        .create((
            TokenSecret {
                hash: hash_token(&plaintext),
                preview: preview_of(&plaintext),
            },
            TokenOwner {
                user_id: auth.id.clone(),
            },
            TokenInfo {
                name: name.to_string(),
                created_at: now.clone(),
                expires_at: expiry_from_days(r.expires_in_days),
            },
            TokenUsage { last_used_at: None },
        ))
        .await
        .map_err(internal)?;
    let rec = load_token(&store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_internal("token vanished after create"))?;
    Ok(ConnectResponse::new(pb::CreateTokenResponse {
        token: plaintext,
        access_token: Some(to_proto(&rec, &now)),
    }))
}

async fn list_tokens(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    _req: ConnectRequest<pb::ListTokensRequest>,
) -> Result<ConnectResponse<pb::ListTokensResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let now = now_iso();
    let rows = tokens_for_owner(&store, &auth.id).await.map_err(internal)?;
    Ok(ConnectResponse::new(pb::ListTokensResponse {
        tokens: rows.iter().map(|t| to_proto(t, &now)).collect(),
    }))
}

/// Revoke = delete the entity. A token belonging to someone else answers
/// `not_found`, not `permission_denied`: distinguishing the two would leak
/// which ids exist.
async fn revoke_token(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::RevokeTokenRequest>,
) -> Result<ConnectResponse<pb::RevokeTokenResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = r
        .id
        .parse::<i64>()
        .map_err(|_| ConnectError::new_not_found("token not found"))?;
    let rec = load_token(&store, pid)
        .await
        .map_err(internal)?
        .filter(|t| t.user_id == auth.id)
        .ok_or_else(|| ConnectError::new_not_found("token not found"))?;
    store.delete(rec.pid).await.map_err(internal)?;
    Ok(ConnectResponse::new(pb::RevokeTokenResponse { ok: true }))
}

/// AccessTokenService router; injects the Store as a request extension.
pub fn token_router(store: Arc<Store>) -> axum::Router<()> {
    type S = Extension<Arc<Store>>;
    type A = Option<Extension<AuthUser>>;
    AccessTokenServiceBuilder::<()>::new()
        .create_token::<_, (S, A, ConnectRequest<pb::CreateTokenRequest>)>(create_token)
        .list_tokens::<_, (S, A, ConnectRequest<pb::ListTokensRequest>)>(list_tokens)
        .revoke_token::<_, (S, A, ConnectRequest<pb::RevokeTokenRequest>)>(revoke_token)
        .build()
        .layer(Extension(store))
}
