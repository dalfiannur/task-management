//! Media: per-project files (S3-backed) + task↔media links. "Is a file" = has
//! [`MediaFileInfo`]; "is a link" = has [`TaskMediaLinkData`]. Status stored as
//! an indexed `String`.

/// File metadata (bytes live in S3 under `storage_key`).
#[derive(Debug, Clone)]
pub struct MediaFileInfo {
    pub project_id: String,
    pub file_name: String,
    pub original_file_name: String,
    pub mime_type: String,
    pub size: i64,
    pub storage_key: String,
    pub uploaded_by: String,
    pub created_at: String,
    pub status: String, // MediaStatus::as_str
}

/// Many-to-many task↔file link.
#[derive(Debug, Clone)]
pub struct TaskMediaLinkData {
    pub media_file_id: String,
    pub task_id: String,
    pub project_id: String,
}

/// Upload lifecycle. Mirrors proto (PENDING=1, READY=2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaStatus {
    /// Row created; bytes not yet confirmed in S3.
    Pending,
    /// Upload confirmed (object present).
    Ready,
}

impl MediaStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Ready => "ready",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(Self::Pending),
            "ready" => Some(Self::Ready),
            _ => None,
        }
    }
    pub fn to_proto(self) -> i32 {
        match self {
            Self::Pending => 1,
            Self::Ready => 2,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_round_trip_and_proto() {
        for s in [MediaStatus::Pending, MediaStatus::Ready] {
            assert_eq!(MediaStatus::parse(s.as_str()), Some(s));
        }
        assert_eq!(MediaStatus::parse("bogus"), None);
        assert_eq!(MediaStatus::Pending.to_proto(), 1);
        assert_eq!(MediaStatus::Ready.to_proto(), 2);
    }
}
