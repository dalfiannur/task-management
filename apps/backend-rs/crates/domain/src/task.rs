//! Task: the unit of work inside a module. Status/priority stored as indexed
//! `String`; assignees/labels as JSONB `Vec<String>`.

use arke_postgres::PgComponent;

/// Core task fields.
#[derive(PgComponent, Debug, Clone)]
pub struct TaskInfo {
    pub title: String,
    pub description: String,
    #[pg(index)]
    pub status: String, // TaskStatus::as_str
    #[pg(index)]
    pub priority: String, // TaskPriority::as_str
    pub start_date: Option<String>,
    pub due_date: Option<String>,
    /// Sort order within the module. Named `sort_order` (not `order`) because
    /// `order` is a reserved SQL keyword and the derive doesn't quote identifiers.
    #[pg(index)]
    pub sort_order: i32,
}

/// Owning module (`pid` string); project is derived through the module.
#[derive(PgComponent, Debug, Clone)]
pub struct TaskModuleRef {
    #[pg(index)]
    pub module_id: String,
}

/// Assignee user ids (JSONB). Must be members of the task's project.
#[derive(PgComponent, Debug, Clone)]
pub struct TaskAssignees {
    pub user_ids: Vec<String>,
}

/// Label references (JSONB). Palette management is a separate flow.
#[derive(PgComponent, Debug, Clone)]
pub struct TaskLabels {
    pub label_ids: Vec<String>,
}

/// Audit trail.
#[derive(PgComponent, Debug, Clone)]
pub struct TaskAudit {
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub created_by: String,
}

/// Work status. Mirrors proto (TODO=1, IN_PROGRESS=2, DONE=3, CANCELLED=4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskStatus {
    Todo,
    InProgress,
    Done,
    Cancelled,
}

impl TaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Todo => "todo",
            Self::InProgress => "in_progress",
            Self::Done => "done",
            Self::Cancelled => "cancelled",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "todo" => Some(Self::Todo),
            "in_progress" => Some(Self::InProgress),
            "done" => Some(Self::Done),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }
    pub fn to_proto(self) -> i32 {
        match self {
            Self::Todo => 1,
            Self::InProgress => 2,
            Self::Done => 3,
            Self::Cancelled => 4,
        }
    }
    /// From proto wire value; `None` for UNSPECIFIED(0)/unknown.
    pub fn from_proto(code: i32) -> Option<Self> {
        match code {
            1 => Some(Self::Todo),
            2 => Some(Self::InProgress),
            3 => Some(Self::Done),
            4 => Some(Self::Cancelled),
            _ => None,
        }
    }
}

/// Priority. Mirrors proto (NONE=1, LOW=2, MEDIUM=3, HIGH=4, URGENT=5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskPriority {
    None,
    Low,
    Medium,
    High,
    Urgent,
}

impl TaskPriority {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Urgent => "urgent",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "none" => Some(Self::None),
            "low" => Some(Self::Low),
            "medium" => Some(Self::Medium),
            "high" => Some(Self::High),
            "urgent" => Some(Self::Urgent),
            _ => None,
        }
    }
    pub fn to_proto(self) -> i32 {
        match self {
            Self::None => 1,
            Self::Low => 2,
            Self::Medium => 3,
            Self::High => 4,
            Self::Urgent => 5,
        }
    }
    /// From proto wire value; `None` for UNSPECIFIED(0)/unknown.
    pub fn from_proto(code: i32) -> Option<Self> {
        match code {
            1 => Some(Self::None),
            2 => Some(Self::Low),
            3 => Some(Self::Medium),
            4 => Some(Self::High),
            5 => Some(Self::Urgent),
            _ => None,
        }
    }
}

/// A task title is valid iff it has non-whitespace content.
pub fn title_ok(title: &str) -> bool {
    !title.trim().is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_round_trip_and_proto() {
        for s in [
            TaskStatus::Todo,
            TaskStatus::InProgress,
            TaskStatus::Done,
            TaskStatus::Cancelled,
        ] {
            assert_eq!(TaskStatus::parse(s.as_str()), Some(s));
            assert_eq!(TaskStatus::from_proto(s.to_proto()), Some(s));
        }
        assert_eq!(TaskStatus::from_proto(0), None);
        assert_eq!(TaskStatus::parse("bogus"), None);
    }

    #[test]
    fn priority_round_trip_and_proto() {
        for p in [
            TaskPriority::None,
            TaskPriority::Low,
            TaskPriority::Medium,
            TaskPriority::High,
            TaskPriority::Urgent,
        ] {
            assert_eq!(TaskPriority::parse(p.as_str()), Some(p));
            assert_eq!(TaskPriority::from_proto(p.to_proto()), Some(p));
        }
        assert_eq!(TaskPriority::from_proto(0), None);
    }

    #[test]
    fn title_validation() {
        assert!(title_ok("Ship it"));
        assert!(!title_ok("   "));
    }
}
