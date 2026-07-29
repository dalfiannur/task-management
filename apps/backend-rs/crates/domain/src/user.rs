//! User identity: persisted ECS components + pure rules (persistence-agnostic).
//!
//! Design note: `arke-postgres`'s `PgComponent` derive rejects zero-field structs,
//! so the spec's `UserTag`/`AdminTag` markers become: "is a user" = has [`UserPhone`],
//! and admin = presence of [`AdminMark`]. `UserStatus` is stored as an indexed
//! `String` (see [`UserStatus::as_str`]), not an enum column.

use arke_postgres::PgComponent;

/// Login identity. Phone is unique (the login handle).
#[derive(PgComponent, Debug, Clone)]
pub struct UserPhone {
    #[pg(index, unique)]
    pub value: String,
    pub verified: bool,
}

/// Argon2id PHC string. Never exposed over the wire.
#[derive(PgComponent, Debug, Clone)]
pub struct UserPassword {
    pub hash: String,
    pub changed_at: String,
}

/// Display profile.
#[derive(PgComponent, Debug, Clone)]
pub struct UserProfile {
    #[pg(index)]
    pub display_name: String,
    pub avatar_url: String,
    pub email: String,
}

/// Account lifecycle. `status` = [`UserStatus::as_str`].
#[derive(PgComponent, Debug, Clone)]
pub struct UserStatusComponent {
    #[pg(index)]
    pub status: String,
    pub created_at: String,
    pub last_login_at: Option<String>,
}

/// **Presence = admin** (derive rejects 0-field structs, so carry a timestamp).
/// `SetAdmin(true)` inserts it, `SetAdmin(false)` removes it.
#[derive(PgComponent, Debug, Clone)]
pub struct AdminMark {
    pub granted_at: String,
}

/// Account lifecycle state. Mirrors proto `UserStatus` (wire: PENDING=1, ACTIVE=2,
/// SUSPENDED=3; UNSPECIFIED=0 is not a valid stored state).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserStatus {
    Pending,
    Active,
    Suspended,
}

impl UserStatus {
    /// Stored string form (the `UserStatusComponent.status` column value).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Active => "active",
            Self::Suspended => "suspended",
        }
    }

    /// Parse the stored string form; `None` for anything else.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(Self::Pending),
            "active" => Some(Self::Active),
            "suspended" => Some(Self::Suspended),
            _ => None,
        }
    }

    /// proto wire enum value.
    pub fn to_proto(self) -> i32 {
        match self {
            Self::Pending => 1,
            Self::Active => 2,
            Self::Suspended => 3,
        }
    }
}

/// Minimum password length (spec §8: min 8).
pub const MIN_PASSWORD_LEN: usize = 8;

/// Permissions granted to a plain active user at login (spec §8).
pub const BASE_PERMISSIONS: &[&str] = &["projects:create"];

/// Permissions minted into the JWT at login: admin → `["*"]`, else [`BASE_PERMISSIONS`].
pub fn permissions_for(is_admin: bool) -> Vec<String> {
    if is_admin {
        vec!["*".to_string()]
    } else {
        BASE_PERMISSIONS.iter().map(|s| s.to_string()).collect()
    }
}

/// Password meets the minimum policy.
pub fn password_ok(pw: &str) -> bool {
    pw.chars().count() >= MIN_PASSWORD_LEN
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_status_round_trip_and_proto() {
        for s in [UserStatus::Pending, UserStatus::Active, UserStatus::Suspended] {
            assert_eq!(UserStatus::parse(s.as_str()), Some(s));
        }
        assert_eq!(UserStatus::parse("bogus"), None);
        assert_eq!(UserStatus::Pending.to_proto(), 1);
        assert_eq!(UserStatus::Active.to_proto(), 2);
        assert_eq!(UserStatus::Suspended.to_proto(), 3);
    }

    #[test]
    fn permissions_admin_vs_base() {
        assert_eq!(permissions_for(true), vec!["*".to_string()]);
        assert_eq!(permissions_for(false), vec!["projects:create".to_string()]);
    }

    #[test]
    fn password_policy_boundary() {
        assert!(!password_ok("1234567")); // 7
        assert!(password_ok("12345678")); // 8
    }
}
