//! Verifying personal access tokens for the MCP endpoint.
//!
//! This path is deliberately separate from the application's `auth_layer`:
//! the browser session JWT doesn't work here, and a PAT doesn't work against
//! the Connect API. The two credentials never cross paths, so a leaked PAT
//! only opens up the MCP tools.

use auth::AuthUser;
use domain::token::{hash_token, is_expired, looks_like_token};
use persistence::Store;
use transport::api::{auth_user_for, find_by_hash, TokenRecord};

/// Deliberately a single variant: distinguishing "token doesn't exist" from
/// "token expired" in the response would tell a guesser which one is closer.
#[derive(Debug)]
pub struct Unauthorized;

/// Whole seconds, deliberately. `Rfc3339` only writes a fractional-second part
/// when the nanoseconds aren't zero, and trims trailing zeros when they aren't
/// — so the string width varies. `domain::token::is_expired` compares these
/// strings lexicographically, and that comparison only tracks time order when
/// every side is at the same precision. Pinning the precision here is what
/// makes that precondition actually hold.
fn now_iso() -> String {
    use time::format_description::well_known::Rfc3339;
    let now = time::OffsetDateTime::now_utc();
    now.replace_nanosecond(0)
        .unwrap_or(now)
        .format(&Rfc3339)
        .unwrap_or_default()
}

/// `Authorization` header → the portal user, or `Unauthorized`.
pub async fn authenticate(store: &Store, header: Option<&str>) -> Result<AuthUser, Unauthorized> {
    let raw = header.ok_or(Unauthorized)?;
    let token = raw
        .strip_prefix("Bearer ")
        .or_else(|| raw.strip_prefix("bearer "))
        .ok_or(Unauthorized)?
        .trim();
    // Screen the shape first: a string we could never have issued never
    // reaches the database, and that's also what makes the digest safe to use
    // in building the SQL predicate in `find_by_hash`.
    if !looks_like_token(token) {
        return Err(Unauthorized);
    }
    let rec: TokenRecord = find_by_hash(store, &hash_token(token))
        .await
        .map_err(|_| Unauthorized)?
        .ok_or(Unauthorized)?;
    let now = now_iso();
    if is_expired(rec.expires_at.as_deref(), &now) {
        return Err(Unauthorized);
    }
    let user = auth_user_for(store, &rec.user_id)
        .await
        .map_err(|_| Unauthorized)?
        .ok_or(Unauthorized)?;
    touch(store, &rec, &now).await;
    Ok(user)
}

/// Record usage, but at most once an hour.
///
/// Without this throttle, every tool call — and a single AI conversation can
/// trigger a dozen — would write a database row just to refresh a timestamp
/// that a human reads only occasionally.
async fn touch(store: &Store, rec: &TokenRecord, now: &str) {
    use time::format_description::well_known::Rfc3339;
    let at = time::OffsetDateTime::now_utc() - time::Duration::hours(1);
    let cutoff = at
        .replace_nanosecond(0)
        .unwrap_or(at)
        .format(&Rfc3339)
        .unwrap_or_default();
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
