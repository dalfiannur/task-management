//! The report's time window.
//!
//! Stored timestamps are inconsistent in width: `transport::now_iso()` formats
//! RFC3339 *without* pinning nanoseconds, so `created_at` may be
//! `…T10:23:45Z` or `…T10:23:45.123456789Z`. Compared lexicographically, `.`
//! (0x2E) sorts below `Z` (0x5A), so a fractional value can land on the wrong
//! side of a non-fractional boundary.
//!
//! The fix is to truncate the *boundary* to `YYYY-MM-DDTHH:MM:SS` and leave the
//! stored value alone. Every stored form then orders correctly: a fractional
//! value shares the 19-character prefix and is longer, so it sorts above the
//! boundary — correct, being later within that second; a plain value ends in
//! `Z`, also above; a value in another second differs before character 19. The
//! result is exact at second precision on both bounds, and — because the stored
//! column is never transformed — it stays usable by the `created_at` index.

/// A half-open window `[start, end)`. Both bounds are 19-character
/// `YYYY-MM-DDTHH:MM:SS` strings, safe to interpolate into a SQL predicate
/// because [`Window::parse`] admits nothing but digits and fixed separators.
#[derive(Debug, Clone)]
pub(crate) struct Window {
    start: String,
    end: String,
}

/// `YYYY-MM-DDTHH:MM:SS` from an RFC3339 instant, or `None` if `s` is not one.
/// The `T` is normalised to upper case: RFC3339 permits a lowercase `t`, and a
/// boundary carrying one would never compare equal to stored values that use
/// `T`.
fn truncate(s: &str) -> Option<String> {
    let b = s.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let digit = |i: usize| b[i].is_ascii_digit();
    let shaped = digit(0)
        && digit(1)
        && digit(2)
        && digit(3)
        && b[4] == b'-'
        && digit(5)
        && digit(6)
        && b[7] == b'-'
        && digit(8)
        && digit(9)
        && (b[10] == b'T' || b[10] == b't')
        && digit(11)
        && digit(12)
        && b[13] == b':'
        && digit(14)
        && digit(15)
        && b[16] == b':'
        && digit(17)
        && digit(18);
    if !shaped {
        return None;
    }
    let mut out = s[..19].to_string();
    out.replace_range(10..11, "T");
    Some(out)
}

impl Window {
    /// `None` for a malformed instant, or for a window that is empty or
    /// inverted — those are caller errors and must surface as
    /// `invalid_argument`, never as an empty report.
    pub(crate) fn parse(start: &str, end: &str) -> Option<Self> {
        let (start, end) = (truncate(start)?, truncate(end)?);
        if start >= end {
            return None;
        }
        Some(Self { start, end })
    }

    pub(crate) fn start(&self) -> &str {
        &self.start
    }

    pub(crate) fn end(&self) -> &str {
        &self.end
    }

    /// Is a stored RFC3339 timestamp inside `[start, end)`?
    pub(crate) fn contains(&self, ts: &str) -> bool {
        ts >= self.start.as_str() && ts < self.end.as_str()
    }

    /// Absent (`completed_at` on an unfinished task) is outside every window.
    pub(crate) fn contains_opt(&self, ts: Option<&String>) -> bool {
        ts.is_some_and(|t| self.contains(t))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const START: &str = "2026-09-07T00:00:00.000Z";
    const END: &str = "2026-09-14T00:00:00.000Z";

    fn w() -> Window {
        Window::parse(START, END).expect("valid window")
    }

    #[test]
    fn boundary_start_is_inclusive_end_is_exclusive() {
        let w = w();
        assert!(w.contains("2026-09-07T00:00:00Z"), "exactly start is in");
        assert!(!w.contains("2026-09-14T00:00:00Z"), "exactly end is out");
        assert!(w.contains("2026-09-13T23:59:59Z"), "last second is in");
        assert!(!w.contains("2026-09-06T23:59:59Z"), "before start is out");
    }

    #[test]
    fn fractional_and_plain_seconds_classify_identically() {
        let w = w();
        // transport::now_iso() does not pin nanoseconds, so both forms occur.
        assert!(w.contains("2026-09-07T00:00:00.000000001Z"));
        assert!(w.contains("2026-09-07T00:00:00Z"));
        assert!(!w.contains("2026-09-14T00:00:00.000000001Z"));
        assert!(!w.contains("2026-09-14T00:00:00Z"));
    }

    #[test]
    fn contains_opt_treats_absent_as_outside() {
        let w = w();
        assert!(!w.contains_opt(None));
        assert!(w.contains_opt(Some(&"2026-09-08T12:00:00Z".to_string())));
    }

    #[test]
    fn boundaries_are_truncated_to_seconds_and_normalised() {
        let w = Window::parse("2026-09-07t00:00:00.5Z", END).unwrap();
        assert_eq!(w.start(), "2026-09-07T00:00:00", "lowercase t normalised");
        assert_eq!(w.end(), "2026-09-14T00:00:00");
    }

    #[test]
    fn malformed_or_inverted_windows_are_rejected() {
        assert!(Window::parse("", END).is_none());
        assert!(Window::parse("2026-09-07", END).is_none(), "too short");
        assert!(Window::parse("2026-09-07X00:00:00Z", END).is_none(), "bad sep");
        assert!(Window::parse("20xx-09-07T00:00:00Z", END).is_none(), "not digits");
        assert!(Window::parse(END, START).is_none(), "end before start");
        assert!(Window::parse(START, START).is_none(), "empty window");
    }
}
