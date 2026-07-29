//! Label: per-project categorization vocabulary (name + hex color). "Is a label"
//! = has [`LabelInfo`]. Delete is tolerant — tasks keep dangling `label_ids`.

use arke_postgres::PgComponent;

#[derive(PgComponent, Debug, Clone)]
pub struct LabelInfo {
    #[pg(index)]
    pub project_id: String,
    #[pg(index)]
    pub name: String,
    pub color: String, // hex, e.g. "#4f46e5"
}

/// A label name is valid iff it has non-whitespace content.
pub fn label_name_ok(name: &str) -> bool {
    !name.trim().is_empty()
}

/// Color must be `#RRGGBB` (7 chars, `#` + 6 hex digits).
pub fn color_ok(color: &str) -> bool {
    color.len() == 7
        && color.starts_with('#')
        && color[1..].chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_validation() {
        assert!(label_name_ok("bug"));
        assert!(!label_name_ok("  "));
    }

    #[test]
    fn color_validation() {
        assert!(color_ok("#4f46e5"));
        assert!(color_ok("#ABCDEF"));
        assert!(!color_ok("4f46e5")); // missing #
        assert!(!color_ok("#fff")); // too short
        assert!(!color_ok("#12345g")); // non-hex
        assert!(!color_ok("")); // empty
    }
}
