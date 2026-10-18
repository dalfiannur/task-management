//! Saved view: a named filter + layout over a project's Tasks tab. "Is a
//! saved view" = has [`SavedViewInfo`]. The filter is the tab's URL query
//! string, kept verbatim so filters added later need no migration.

#[derive(Debug, Clone)]
pub struct SavedViewInfo {
    pub project_id: String,
    pub owner_id: String,
    pub name: String,
    pub query: String,
    pub layout: String, // ViewLayout::as_str
    pub shared: bool,
    pub created_at: String,
}

/// Layout the view opens in. Mirrors proto (LIST=1, BOARD=2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ViewLayout {
    List,
    Board,
}

impl ViewLayout {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::List => "list",
            Self::Board => "board",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "list" => Some(Self::List),
            "board" => Some(Self::Board),
            _ => None,
        }
    }
    pub fn to_proto(self) -> i32 {
        match self {
            Self::List => 1,
            Self::Board => 2,
        }
    }
    /// From proto wire value; `None` for UNSPECIFIED(0)/unknown.
    pub fn from_proto(code: i32) -> Option<Self> {
        match code {
            1 => Some(Self::List),
            2 => Some(Self::Board),
            _ => None,
        }
    }
}

pub const MAX_VIEW_NAME: usize = 80;
pub const MAX_VIEW_QUERY: usize = 2000;

/// A view name is valid iff it has content and fits.
pub fn view_name_ok(name: &str) -> bool {
    let n = name.trim();
    !n.is_empty() && n.chars().count() <= MAX_VIEW_NAME
}

/// The stored form of a query: trimmed, without a leading `?`. `None` when
/// too long.
pub fn normalize_query(query: &str) -> Option<String> {
    let q = query.trim().trim_start_matches('?');
    (q.len() <= MAX_VIEW_QUERY).then(|| q.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_queries() {
        assert!(view_name_ok("Bugs this week"));
        assert!(!view_name_ok("  "));
        assert!(!view_name_ok(&"x".repeat(MAX_VIEW_NAME + 1)));
        assert_eq!(normalize_query(" ?status=1&q=a ").as_deref(), Some("status=1&q=a"));
        assert_eq!(normalize_query(&"a".repeat(MAX_VIEW_QUERY + 1)), None);
    }

    #[test]
    fn layout_round_trips() {
        for l in [ViewLayout::List, ViewLayout::Board] {
            assert_eq!(ViewLayout::parse(l.as_str()), Some(l));
            assert_eq!(ViewLayout::from_proto(l.to_proto()), Some(l));
        }
        assert_eq!(ViewLayout::from_proto(0), None);
    }
}
