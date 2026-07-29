//! Activity: project-wide audit log ("who did what"), generalized across entity
//! types. "Is an activity" = has [`ActivityInfo`]. `summary` is a snapshot;
//! `changes` (diff) is only populated for updates.

use arke_postgres::PgComponent;

/// One changed field in an update diff (JSONB payload — `arke::Serialize`).
#[derive(arke::Serialize, Debug, Clone, PartialEq)]
pub struct FieldChange {
    pub field: String,
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(PgComponent, Debug, Clone)]
pub struct ActivityInfo {
    #[pg(index)]
    pub project_id: String,
    #[pg(index)]
    pub actor_id: String,
    #[pg(index)]
    pub entity_type: String, // EntityType::as_str
    #[pg(index)]
    pub entity_id: String,
    #[pg(index)]
    pub action: String, // ActivityAction::as_str
    pub summary: String,
    #[pg(index)]
    pub created_at: String,
}

/// Update diff (JSONB); empty for create/delete.
#[derive(PgComponent, Debug, Clone)]
pub struct ActivityChanges {
    pub changes: Vec<FieldChange>,
}

/// What the activity is about. Mirrors proto (TASK=1 … MEDIA=6).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityType {
    Task,
    Module,
    Membership,
    Ownership,
    Page,
    Media,
}

impl EntityType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Task => "task",
            Self::Module => "module",
            Self::Membership => "membership",
            Self::Ownership => "ownership",
            Self::Page => "page",
            Self::Media => "media",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "task" => Some(Self::Task),
            "module" => Some(Self::Module),
            "membership" => Some(Self::Membership),
            "ownership" => Some(Self::Ownership),
            "page" => Some(Self::Page),
            "media" => Some(Self::Media),
            _ => None,
        }
    }
    pub fn to_proto(self) -> i32 {
        match self {
            Self::Task => 1,
            Self::Module => 2,
            Self::Membership => 3,
            Self::Ownership => 4,
            Self::Page => 5,
            Self::Media => 6,
        }
    }
    pub fn from_proto(code: i32) -> Option<Self> {
        match code {
            1 => Some(Self::Task),
            2 => Some(Self::Module),
            3 => Some(Self::Membership),
            4 => Some(Self::Ownership),
            5 => Some(Self::Page),
            6 => Some(Self::Media),
            _ => None,
        }
    }
}

/// Mirrors proto (CREATED=1, UPDATED=2, DELETED=3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivityAction {
    Created,
    Updated,
    Deleted,
}

impl ActivityAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Updated => "updated",
            Self::Deleted => "deleted",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "created" => Some(Self::Created),
            "updated" => Some(Self::Updated),
            "deleted" => Some(Self::Deleted),
            _ => None,
        }
    }
    pub fn to_proto(self) -> i32 {
        match self {
            Self::Created => 1,
            Self::Updated => 2,
            Self::Deleted => 3,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enums_round_trip_and_proto() {
        for e in [
            EntityType::Task,
            EntityType::Module,
            EntityType::Membership,
            EntityType::Ownership,
            EntityType::Page,
            EntityType::Media,
        ] {
            assert_eq!(EntityType::parse(e.as_str()), Some(e));
            assert_eq!(EntityType::from_proto(e.to_proto()), Some(e));
        }
        assert_eq!(EntityType::from_proto(0), None);
        for a in [
            ActivityAction::Created,
            ActivityAction::Updated,
            ActivityAction::Deleted,
        ] {
            assert_eq!(ActivityAction::parse(a.as_str()), Some(a));
        }
        assert_eq!(ActivityAction::Updated.to_proto(), 2);
    }
}
