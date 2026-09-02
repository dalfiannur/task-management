//! Verifying personal access tokens for the MCP endpoint.
//!
//! This path is deliberately separate from the application's `auth_layer`:
//! the browser session JWT doesn't work here, and a PAT doesn't work against
//! the Connect API. The two credentials never cross paths, so a leaked PAT
//! only opens up the MCP tools.

use auth::AuthUser;
use domain::token::{hash_token, is_expired, looks_like_token, now_iso};
use persistence::Store;
use transport::api::{auth_user_for, find_by_hash, TokenRecord};

/// Why a request was refused.
///
/// Every *credential* failure collapses into one variant on purpose: telling a
/// guesser their token was expired rather than unknown tells them the guess was
/// nearly right. Infrastructure failure is separate, because it is not the
/// caller's fault — answering 401 sends a user off to reissue a token that was
/// never the problem, and an outage dressed as a wave of 401s is something an
/// operator would struggle to recognise. Nothing an attacker controls selects
/// between the two variants, so the split leaks nothing.
#[derive(Debug)]
pub enum AuthFailure {
    Unauthorized,
    Unavailable,
}

/// `Authorization` header → the portal user, or the reason it was refused.
/// The client learns only that it was refused. The log records which branch
/// fired, because "someone is hammering us with garbage" and "a real user's
/// token expired last week" need different responses from an operator, and
/// this function is the only place that still knows the difference.
pub async fn authenticate(store: &Store, header: Option<&str>) -> Result<AuthUser, AuthFailure> {
    let Some(raw) = header else {
        tracing::debug!("mcp: request carried no Authorization header");
        return Err(AuthFailure::Unauthorized);
    };
    let Some(token) = raw
        .strip_prefix("Bearer ")
        .or_else(|| raw.strip_prefix("bearer "))
        .map(str::trim)
    else {
        tracing::debug!("mcp: Authorization header is not a Bearer credential");
        return Err(AuthFailure::Unauthorized);
    };
    // Screen the shape first: a string we could never have issued never reaches
    // the database, and that is also what makes the digest safe to interpolate
    // into `find_by_hash`'s SQL predicate.
    if !looks_like_token(token) {
        tracing::debug!("mcp: bearer credential is not shaped like a token");
        return Err(AuthFailure::Unauthorized);
    }
    let found = find_by_hash(store, &hash_token(token)).await.map_err(|e| {
        tracing::error!(error = %e, "mcp: token lookup failed");
        AuthFailure::Unavailable
    })?;
    let Some(rec) = found else {
        tracing::debug!("mcp: no token matches that digest");
        return Err(AuthFailure::Unauthorized);
    };
    // Expiry before owner resolution: a dead token is not worth a second
    // round-trip to load the user it used to belong to.
    let now = now_iso();
    if is_expired(rec.expires_at.as_deref(), &now) {
        tracing::debug!(token = rec.pid, "mcp: token has expired");
        return Err(AuthFailure::Unauthorized);
    }
    let owner = auth_user_for(store, &rec.user_id).await.map_err(|e| {
        tracing::error!(error = %e, "mcp: owner lookup failed");
        AuthFailure::Unavailable
    })?;
    let Some(user) = owner else {
        tracing::warn!(token = rec.pid, "mcp: token outlived its owner or the owner is not active");
        return Err(AuthFailure::Unauthorized);
    };
    // Only after both checks pass: a refused attempt is not usage.
    touch(store, &rec, &now).await;
    Ok(user)
}

/// Record usage, but skip the write if it was already recorded within the hour.
///
/// This is a throttle, not a lock. Concurrent calls each read the same stale
/// timestamp and each decide to write, so a burst from one conversation can
/// still produce a handful of writes — it bounds the steady state, not the
/// burst. That is deliberate: the value is a timestamp a human glances at
/// occasionally, and paying for an atomic conditional update to spare it a few
/// redundant writes would cost more than it saves.
async fn touch(store: &Store, rec: &TokenRecord, now: &str) {
    // Same precision guarantee as `now_iso`, applied to a different instant —
    // see `domain::token::pinned_rfc3339` for why this doesn't re-derive the
    // pinning logic locally.
    let cutoff = domain::token::pinned_rfc3339(
        time::OffsetDateTime::now_utc() - time::Duration::hours(1),
    );
    let fresh = rec
        .last_used_at
        .as_deref()
        .map(|t| t > cutoff.as_str())
        .unwrap_or(false);
    if fresh {
        return;
    }
    let stamp = now.to_string();
    if let Err(e) = store
        .update(rec.pid, move |w, e| {
            w.remove::<domain::token::TokenUsage>(e);
            w.insert(
                e,
                domain::token::TokenUsage {
                    last_used_at: Some(stamp),
                },
            );
        })
        .await
    {
        // Failing to record usage must not fail the tool call itself.
        tracing::warn!(error = %e, token = rec.pid, "failed to record token usage");
    }
}
