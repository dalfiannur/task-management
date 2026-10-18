//! Templates: a project copied from another with its dates moved, and task
//! templates (a task's fields plus its subtask titles, reusable in a project).

use time::Duration;

use crate::workload::{format_date, parse_date};

pub const MAX_TEMPLATE_NAME: usize = 80;
pub const MAX_TEMPLATE_SUBTASKS: usize = 50;

pub fn template_name_ok(name: &str) -> bool {
    let n = name.trim().chars().count();
    (1..=MAX_TEMPLATE_NAME).contains(&n)
}

/// Days from `from` to `to` (both `yyyy-MM-dd`, anything after ignored), or
/// `None` when either does not parse.
pub fn day_shift(from: &str, to: &str) -> Option<i64> {
    Some((parse_date(to)? - parse_date(from)?).whole_days())
}

/// `date` moved by `days`, as `yyyy-MM-dd`. A date that does not parse is
/// kept as it is rather than lost.
pub fn shift_date(date: &str, days: i64) -> String {
    match parse_date(date) {
        Some(d) if days != 0 => format_date(d + Duration::days(days)),
        Some(d) => format_date(d),
        None => date.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shifting() {
        assert_eq!(day_shift("2026-01-01", "2026-03-01"), Some(59));
        assert_eq!(day_shift("2026-03-01", "2026-01-01"), Some(-59));
        assert_eq!(day_shift("x", "2026-01-01"), None);
        assert_eq!(shift_date("2026-01-30", 3), "2026-02-02");
        assert_eq!(shift_date("2026-01-30T10:00:00Z", 0), "2026-01-30");
        assert_eq!(shift_date("garbage", 5), "garbage");
    }

    #[test]
    fn names() {
        assert!(template_name_ok("Bug triage"));
        assert!(!template_name_ok("   "));
        assert!(!template_name_ok(&"x".repeat(81)));
    }
}
