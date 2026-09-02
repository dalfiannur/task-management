//! Personal access token (PAT) for the MCP endpoint: ECS components + pure rules.
//!
//! Design note: the secret is stored as a **SHA-256 digest, not Argon2**. A PAT
//! carries 256 bits of entropy so it isn't brute-forceable like a human password,
//! while Argon2 would add ~50-100 ms to *every* MCP tool call. Password hashing
//! stays on `user::UserPassword`.

use arke_postgres::PgComponent;

/// Prefix of every token we issue, so a leaked string is easy to grep for.
pub const TOKEN_PREFIX: &str = "sjw_pat_";

/// Opaque secret, stored only as a digest. `preview` is the plaintext's last 4
/// characters — the only part the UI is ever allowed to show again.
#[derive(PgComponent, Debug, Clone)]
pub struct TokenSecret {
    #[pg(index, unique)]
    pub hash: String,
    pub preview: String,
}

/// The token's owner. Indexed because every list read filters by it.
#[derive(PgComponent, Debug, Clone)]
pub struct TokenOwner {
    #[pg(index)]
    pub user_id: String,
}

#[derive(PgComponent, Debug, Clone)]
pub struct TokenInfo {
    pub name: String,
    pub created_at: String,
    /// RFC3339. `None` = never expires (`expires_in_days = 0`).
    pub expires_at: Option<String>,
}

#[derive(PgComponent, Debug, Clone)]
pub struct TokenUsage {
    pub last_used_at: Option<String>,
}

fn to_hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    })
}

/// Issue a new token: `sjw_pat_` + 32 random bytes in hex.
pub fn generate_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!("{TOKEN_PREFIX}{}", to_hex(&bytes))
}

/// The digest that gets stored. Deterministic — a token lookup is a lookup by hash.
pub fn hash_token(token: &str) -> String {
    use sha2::{Digest, Sha256};
    to_hex(&Sha256::digest(token.as_bytes()))
}

/// Last 4 characters — the only plaintext remnant ever allowed to be seen again.
pub fn preview_of(token: &str) -> String {
    let n = token.chars().count();
    token.chars().skip(n.saturating_sub(4)).collect()
}

/// Shape we could never have issued → reject clearly-not-a-token input before
/// spending a hash computation and a database round-trip.
///
/// `hash_token` is safe to use in building a SQL predicate for a reason
/// independent of this gate: its output is always a 64-character hex digest for
/// any input, so it's structurally safe on its own. This gate serves a different
/// purpose and stands on its own regardless — rejecting obviously malformed
/// input earlier.
pub fn looks_like_token(s: &str) -> bool {
    s.len() == TOKEN_PREFIX.len() + 64
        && s.starts_with(TOKEN_PREFIX)
        && s[TOKEN_PREFIX.len()..].bytes().all(|b| b.is_ascii_hexdigit())
}

/// Past `expires_at` already? `None` = never expires.
///
/// Compares RFC3339 UTC strings lexicographically. This lexical order matches
/// time order ONLY when both sides are formatted at the same fixed precision:
/// `time` crate's RFC3339 formatter omits the fractional-second part when it's
/// zero and trims trailing zeros when it isn't, so the string width varies and
/// can flip the lexical order within the same second (e.g. "...T10:00:00Z" >
/// "...T10:00:00.5Z" lexically, even though 10:00:00.0 is earlier than
/// 10:00:00.5). That's why callers pin the timestamp to a whole second
/// (`replace_nanosecond(0)`) before formatting, so this same-precision
/// precondition actually holds. `task::dates_ok` compares plain `YYYY-MM-DD`
/// dates with no time-of-day and no variable-width component, so the analogy is
/// weaker there — this case doesn't arise for it.
pub fn is_expired(expires_at: Option<&str>, now: &str) -> bool {
    match expires_at {
        None => false,
        Some(e) => e <= now,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_token_has_prefix_and_fixed_length() {
        let t = generate_token();
        assert!(t.starts_with(TOKEN_PREFIX));
        assert_eq!(t.len(), TOKEN_PREFIX.len() + 64);
        assert!(looks_like_token(&t));
    }

    #[test]
    fn two_tokens_differ() {
        assert_ne!(generate_token(), generate_token());
    }

    #[test]
    fn hash_is_stable_and_not_the_plaintext() {
        let t = generate_token();
        let h = hash_token(&t);
        assert_eq!(h, hash_token(&t));
        assert_eq!(h.len(), 64);
        assert!(!h.contains(&t));
    }

    #[test]
    fn preview_is_last_four_chars() {
        assert_eq!(preview_of("sjw_pat_00ff1a2b"), "1a2b");
        assert_eq!(preview_of("ab"), "ab"); // shorter than 4 → returned as-is
    }

    #[test]
    fn garbage_is_not_a_token() {
        assert!(!looks_like_token("hello"));
        assert!(!looks_like_token(&"sjw_pat_".repeat(9)));
        // Right length, but has a non-hex character.
        let bad = format!("{TOKEN_PREFIX}{}", "z".repeat(64));
        assert!(!looks_like_token(&bad));
    }

    #[test]
    fn expiry_compares_lexicographically() {
        assert!(!is_expired(None, "2026-09-02T00:00:00Z"));
        assert!(is_expired(
            Some("2026-09-01T00:00:00Z"),
            "2026-09-02T00:00:00Z"
        ));
        assert!(!is_expired(
            Some("2026-09-03T00:00:00Z"),
            "2026-09-02T00:00:00Z"
        ));
    }
}
