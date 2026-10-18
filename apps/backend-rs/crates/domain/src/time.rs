//! Time entry: minutes of work on a task, from a timer or logged by hand.
//! "Is a time entry" = has [`TimeEntryInfo`]. A running timer has
//! `running = true` and no `ended_at`; its minutes are set when it stops.

#[derive(Debug, Clone)]
pub struct TimeEntryInfo {
    pub task_id: String,
    pub project_id: String,
    pub user_id: String,
    pub work_date: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub running: bool,
    pub minutes: i32,
    pub note: String,
    pub created_at: String,
}

/// Most one entry may hold: a full day.
pub const MAX_ENTRY_MINUTES: i32 = 24 * 60;
pub const MAX_NOTE: usize = 500;

/// A logged amount is valid iff it is 1 … 24 hours.
pub fn entry_minutes_ok(minutes: i32) -> bool {
    (1..=MAX_ENTRY_MINUTES).contains(&minutes)
}

pub fn note_ok(note: &str) -> bool {
    note.chars().count() <= MAX_NOTE
}

/// `yyyy-MM-dd` with a real calendar date.
pub fn date_ok(date: &str) -> bool {
    let b = date.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    let num = |r: std::ops::Range<usize>| date[r].parse::<u32>().ok();
    let (Some(y), Some(m), Some(d)) = (num(0..4), num(5..7), num(8..10)) else {
        return false;
    };
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&d)
}

/// Whole minutes a timer ran, rounded to the nearest minute and at least 1 —
/// a timer started and stopped is never worth nothing — capped at a day.
pub fn timer_minutes(elapsed_seconds: i64) -> i32 {
    let m = (elapsed_seconds.max(0) + 30) / 60;
    m.clamp(1, MAX_ENTRY_MINUTES as i64) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates() {
        assert!(date_ok("2026-10-19"));
        assert!(date_ok("2024-02-29"));
        assert!(!date_ok("2026-02-29"));
        assert!(!date_ok("2026-13-01"));
        assert!(!date_ok("2026-1-01"));
        assert!(!date_ok("today"));
    }

    #[test]
    fn minutes() {
        assert!(entry_minutes_ok(1) && entry_minutes_ok(MAX_ENTRY_MINUTES));
        assert!(!entry_minutes_ok(0) && !entry_minutes_ok(MAX_ENTRY_MINUTES + 1));
        assert_eq!(timer_minutes(0), 1);
        assert_eq!(timer_minutes(29), 1);
        assert_eq!(timer_minutes(90), 2);
        assert_eq!(timer_minutes(3600), 60);
        assert_eq!(timer_minutes(10 * 86_400), MAX_ENTRY_MINUTES);
    }
}
