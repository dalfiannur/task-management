//! Page: per-project markdown wiki page. "Is a page" = has [`PageInfo`].
//! Sort field is `sort_order` (`order` is a reserved SQL keyword).

use arke_postgres::PgComponent;

/// Page content + position.
#[derive(PgComponent, Debug, Clone)]
pub struct PageInfo {
    #[pg(index)]
    pub project_id: String,
    pub title: String,
    pub icon: String, // emoji, may be empty
    pub content: String, // Markdown
    #[pg(index)]
    pub sort_order: i32,
}

/// Authorship trail. Names are resolved by the frontend (not denormalized here).
#[derive(PgComponent, Debug, Clone)]
pub struct PageAudit {
    #[pg(index)]
    pub created_by: String,
    pub last_edited_by: String,
    #[pg(index)]
    pub created_at: String,
    pub updated_at: String,
}

/// Default title for a freshly created page.
pub const DEFAULT_PAGE_TITLE: &str = "Untitled";
