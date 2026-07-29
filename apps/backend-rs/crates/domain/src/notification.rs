//! Notification: in-app alert about something concerning the recipient. "Is a
//! notification" = has [`NotificationInfo`]. `message` is a snapshot rendered at
//! emit time (stays correct if the task/user changes later).

use arke_postgres::PgComponent;

#[derive(PgComponent, Debug, Clone)]
pub struct NotificationInfo {
    #[pg(index)]
    pub recipient_id: String,
    #[pg(index)]
    pub kind: String, // NotificationType::as_str
    pub actor_id: String,
    pub message: String,
    #[pg(index)]
    pub read: bool,
    #[pg(index)]
    pub created_at: String,
}

/// Deep-link targets (for navigation when clicked).
#[derive(PgComponent, Debug, Clone)]
pub struct NotificationRefs {
    pub project_id: Option<String>,
    pub task_id: Option<String>,
    pub comment_id: Option<String>,
}

/// Notification kind. Mirrors proto (MENTION=1 … ACCOUNT_APPROVED=5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotificationType {
    Mention,
    TaskAssigned,
    ProjectMemberAdded,
    OwnershipTransferred,
    AccountApproved,
}

impl NotificationType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mention => "mention",
            Self::TaskAssigned => "task_assigned",
            Self::ProjectMemberAdded => "project_member_added",
            Self::OwnershipTransferred => "ownership_transferred",
            Self::AccountApproved => "account_approved",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "mention" => Some(Self::Mention),
            "task_assigned" => Some(Self::TaskAssigned),
            "project_member_added" => Some(Self::ProjectMemberAdded),
            "ownership_transferred" => Some(Self::OwnershipTransferred),
            "account_approved" => Some(Self::AccountApproved),
            _ => None,
        }
    }
    pub fn to_proto(self) -> i32 {
        match self {
            Self::Mention => 1,
            Self::TaskAssigned => 2,
            Self::ProjectMemberAdded => 3,
            Self::OwnershipTransferred => 4,
            Self::AccountApproved => 5,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_round_trip_and_proto() {
        for k in [
            NotificationType::Mention,
            NotificationType::TaskAssigned,
            NotificationType::ProjectMemberAdded,
            NotificationType::OwnershipTransferred,
            NotificationType::AccountApproved,
        ] {
            assert_eq!(NotificationType::parse(k.as_str()), Some(k));
        }
        assert_eq!(NotificationType::parse("bogus"), None);
        assert_eq!(NotificationType::Mention.to_proto(), 1);
        assert_eq!(NotificationType::AccountApproved.to_proto(), 5);
    }
}
