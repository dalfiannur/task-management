//! Project identity: persisted ECS components + pure rules (delivery-only).
//!
//! Design notes (mirrors `user`): the derive rejects zero-field structs, so "is a
//! project" = has [`ProjectName`] (no marker). `ProjectStatus` is stored as a
//! `String` ([`ProjectStatus::as_str`]). Membership is its own entity keyed by
//! string ids (per-op relations are unsupported), not an `EntityRef`.

use arke_postgres::PgComponent;

/// Project name (required — also the "is a project" signal).
#[derive(PgComponent, Debug, Clone)]
pub struct ProjectName {
    pub value: String,
}

/// Optional description (component absent when empty).
#[derive(PgComponent, Debug, Clone)]
pub struct ProjectDescription {
    pub value: String,
}

/// Owner user id (the `pid` string of the owning user). Owner has authority.
#[derive(PgComponent, Debug, Clone)]
pub struct ProjectOwnerId {
    #[pg(index)]
    pub value: String,
}

/// Work status = [`ProjectStatus::as_str`].
#[derive(PgComponent, Debug, Clone)]
pub struct ProjectStatusComponent {
    pub value: String,
}

/// Timeline dates (ISO-8601 `yyyy-MM-dd`). Set in a later flow, not at create.
#[derive(PgComponent, Debug, Clone)]
pub struct ProjectDates {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

/// **Legacy.** Core Portal project id — never set for new projects; kept for the
/// data-migration transition.
#[derive(PgComponent, Debug, Clone)]
pub struct ProjectCoreRef {
    #[pg(index)]
    pub value: String,
}

/// One membership row (its own entity): user `user_id` belongs to project
/// `project_id` (both are `pid` strings).
#[derive(PgComponent, Debug, Clone)]
pub struct ProjectMembership {
    #[pg(index)]
    pub project_id: String,
    #[pg(index)]
    pub user_id: String,
}

/// Linear work status (no winStage). Mirrors proto `ProjectStatus`
/// (ACTIVE=1, COMPLETED=2, ARCHIVED=3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectStatus {
    Active,
    Completed,
    Archived,
}

impl ProjectStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Completed => "completed",
            Self::Archived => "archived",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "active" => Some(Self::Active),
            "completed" => Some(Self::Completed),
            "archived" => Some(Self::Archived),
            _ => None,
        }
    }

    pub fn to_proto(self) -> i32 {
        match self {
            Self::Active => 1,
            Self::Completed => 2,
            Self::Archived => 3,
        }
    }
}

/// A project name is valid iff it has non-whitespace content.
pub fn project_name_ok(name: &str) -> bool {
    !name.trim().is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_round_trip_and_proto() {
        for s in [
            ProjectStatus::Active,
            ProjectStatus::Completed,
            ProjectStatus::Archived,
        ] {
            assert_eq!(ProjectStatus::parse(s.as_str()), Some(s));
        }
        assert_eq!(ProjectStatus::parse("bogus"), None);
        assert_eq!(ProjectStatus::Active.to_proto(), 1);
        assert_eq!(ProjectStatus::Completed.to_proto(), 2);
        assert_eq!(ProjectStatus::Archived.to_proto(), 3);
    }

    #[test]
    fn name_validation() {
        assert!(project_name_ok("Website Revamp"));
        assert!(!project_name_ok(""));
        assert!(!project_name_ok("   "));
    }
}
