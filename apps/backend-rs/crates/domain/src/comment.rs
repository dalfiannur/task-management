//! Comment: a flat (no-threading) comment on a task, with markdown content and
//! explicit @mentions. "Is a comment" = has [`CommentInfo`]. Author names are
//! resolved by the frontend (not denormalized).

use arke_postgres::PgComponent;

#[derive(PgComponent, Debug, Clone)]
pub struct CommentInfo {
    #[pg(index)]
    pub task_id: String,
    #[pg(index)]
    pub author_id: String,
    pub content: String, // Markdown
    pub mentioned_user_ids: Vec<String>, // JSONB; filtered to project members
    #[pg(index)]
    pub created_at: String,
    pub updated_at: String,
}

/// Comment content is valid iff it has non-whitespace content.
pub fn content_ok(content: &str) -> bool {
    !content.trim().is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_validation() {
        assert!(content_ok("looks good"));
        assert!(!content_ok("   "));
    }
}
