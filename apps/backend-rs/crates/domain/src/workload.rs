//! Workload: working-day calendars and how a task's remaining effort spreads
//! over them. Pure — the transport layer loads rows and calls in here.
//!
//! Days travel two ways: as a bitmask (bit 0 = Monday … bit 6 = Sunday) in
//! storage and arithmetic, and as ISO weekday numbers (1 = Monday … 7 =
//! Sunday) on the wire.

use time::{Date, Duration, Month};

/// Monday to Friday.
pub const DEFAULT_DAYS: i32 = 0b001_1111;
/// 40 hours.
pub const DEFAULT_WEEKLY_MINUTES: i32 = 40 * 60;
/// The most a week can hold.
pub const MAX_WEEKLY_MINUTES: i32 = 7 * 24 * 60;
pub const DEFAULT_WEEKS: usize = 6;
pub const MAX_WEEKS: usize = 12;
/// How far ahead a task's span is walked day by day; beyond it, the rest of
/// the span counts as "later" in one lump.
const MAX_SPAN_DAYS: i64 = 3 * 366;

/// A stored mask is valid iff it names at least one day and nothing else.
pub fn days_ok(mask: i32) -> bool {
    (1..=0b111_1111).contains(&mask)
}

pub fn weekly_minutes_ok(minutes: i32) -> bool {
    (0..=MAX_WEEKLY_MINUTES).contains(&minutes)
}

/// ISO weekdays → mask; `None` for a day outside 1..=7. Duplicates are fine.
pub fn mask_from_iso(days: &[i32]) -> Option<i32> {
    days.iter().try_fold(0, |m, d| {
        (1..=7).contains(d).then(|| m | 1 << (d - 1))
    })
}

/// Mask → ascending ISO weekdays.
pub fn iso_from_mask(mask: i32) -> Vec<i32> {
    (1..=7).filter(|d| mask & 1 << (d - 1) != 0).collect()
}

pub fn works_on(mask: i32, date: Date) -> bool {
    mask & 1 << date.weekday().number_days_from_monday() != 0
}

/// The days a task is spread over: those both the assignee and the project
/// work. When they share none, the assignee's own days, flagged (`true`).
pub fn allocation_days(user: i32, project: i32) -> (i32, bool) {
    match user & project {
        0 => (user, true),
        both => (both, false),
    }
}

/// `yyyy-MM-dd` (anything after the first ten characters is ignored, so a
/// full timestamp parses as its date).
pub fn parse_date(s: &str) -> Option<Date> {
    let s = s.get(..10)?;
    let num = |r: std::ops::Range<usize>| s.get(r)?.parse::<i32>().ok();
    let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    if s.as_bytes()[4] != b'-' || s.as_bytes()[7] != b'-' {
        return None;
    }
    Date::from_calendar_date(y, Month::try_from(u8::try_from(m).ok()?).ok()?, u8::try_from(d).ok()?).ok()
}

pub fn format_date(d: Date) -> String {
    format!("{:04}-{:02}-{:02}", d.year(), d.month() as u8, d.day())
}

/// The Monday of `d`'s week.
pub fn week_start(d: Date) -> Date {
    d - Duration::days(d.weekday().number_days_from_monday() as i64)
}

/// Capacity of the week starting `monday`: the weekly minutes spread evenly
/// over the user's working days, counting only the days from `today` on.
pub fn week_capacity(weekly_minutes: i32, mask: i32, monday: Date, today: Date) -> i32 {
    let per_week = mask.count_ones() as i64;
    if per_week == 0 {
        return 0;
    }
    let left = (0..7)
        .map(|i| monday + Duration::days(i))
        .filter(|d| *d >= today && works_on(mask, *d))
        .count() as i64;
    (weekly_minutes as i64 * left / per_week) as i32
}

/// Where a share of effort lands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Placement {
    /// Due before today: all of it, in one bucket.
    Overdue,
    /// No due date.
    Unscheduled,
    /// Spread over working days: minutes per shown week, then the rest.
    Scheduled { weeks: Vec<i32>, later: i32 },
}

/// The horizon a workload is computed over.
#[derive(Debug, Clone, Copy)]
pub struct Horizon {
    pub today: Date,
    /// Monday of the first week shown.
    pub first: Date,
    pub weeks: usize,
}

impl Horizon {
    pub fn new(today: Date, weeks: usize) -> Self {
        Self { today, first: week_start(today), weeks: weeks.clamp(1, MAX_WEEKS) }
    }

    pub fn week_starts(&self) -> Vec<Date> {
        (0..self.weeks).map(|i| self.first + Duration::weeks(i as i64)).collect()
    }
}

/// Spread `minutes` over the working days (`mask`) from max(start, today) to
/// `due`, evenly, the remainder going one minute at a time to the earliest
/// days. A span with no working day puts everything on the due date.
pub fn place(minutes: i32, start: Option<Date>, due: Option<Date>, mask: i32, h: &Horizon) -> Placement {
    let Some(due) = due else {
        return Placement::Unscheduled;
    };
    if due < h.today {
        return Placement::Overdue;
    }
    let from = start.map_or(h.today, |s| s.max(h.today)).min(due);
    let span = (due - from).whole_days().min(MAX_SPAN_DAYS);
    let mut days: Vec<Date> = (0..=span)
        .map(|i| from + Duration::days(i))
        .filter(|d| works_on(mask, *d))
        .collect();
    if days.is_empty() {
        days.push(due);
    }
    let n = days.len() as i32;
    let (base, extra) = (minutes / n, minutes % n);
    let mut weeks = vec![0; h.weeks];
    let mut later = 0;
    for (i, d) in days.iter().enumerate() {
        let m = base + i32::from((i as i32) < extra);
        let w = (*d - h.first).whole_days() / 7;
        match usize::try_from(w).ok().filter(|w| *w < h.weeks) {
            Some(w) => weeks[w] += m,
            None => later += m,
        }
    }
    Placement::Scheduled { weeks, later }
}

/// Effort left on a task: estimate minus time logged, never below zero.
pub fn remaining(estimate: i32, logged: i64) -> i32 {
    (estimate as i64 - logged).max(0) as i32
}

/// `minutes` split evenly over `n` assignees, the remainder going to the
/// first ones; share `i` of them.
pub fn share(minutes: i32, n: usize, i: usize) -> i32 {
    let n = n.max(1) as i32;
    minutes / n + i32::from((i as i32) < minutes % n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    #[test]
    fn masks_and_iso_days() {
        assert_eq!(mask_from_iso(&[1, 2, 3, 4, 5]), Some(DEFAULT_DAYS));
        assert_eq!(mask_from_iso(&[8]), None);
        assert_eq!(mask_from_iso(&[0]), None);
        assert_eq!(iso_from_mask(0b100_0001), vec![1, 7]);
        assert!(days_ok(1) && days_ok(127) && !days_ok(0) && !days_ok(128));
        // 2026-10-19 is a Monday, the 24th a Saturday.
        assert!(works_on(DEFAULT_DAYS, date!(2026 - 10 - 19)));
        assert!(!works_on(DEFAULT_DAYS, date!(2026 - 10 - 24)));
    }

    #[test]
    fn intersection_falls_back_to_the_user() {
        assert_eq!(allocation_days(DEFAULT_DAYS, 0b000_0011), (0b11, false));
        assert_eq!(allocation_days(0b110_0000, DEFAULT_DAYS), (0b110_0000, true));
    }

    #[test]
    fn dates() {
        assert_eq!(parse_date("2026-10-19T08:00:00Z"), Some(date!(2026 - 10 - 19)));
        assert_eq!(parse_date("2026-02-30"), None);
        assert_eq!(parse_date("nope"), None);
        assert_eq!(week_start(date!(2026 - 10 - 25)), date!(2026 - 10 - 19));
        assert_eq!(format_date(date!(2026 - 1 - 5)), "2026-01-05");
    }

    #[test]
    fn capacity_counts_the_days_left() {
        let mon = date!(2026 - 10 - 19);
        assert_eq!(week_capacity(2400, DEFAULT_DAYS, mon, mon), 2400);
        // From Wednesday: 3 of 5 days.
        assert_eq!(week_capacity(2400, DEFAULT_DAYS, mon, date!(2026 - 10 - 21)), 1440);
        assert_eq!(week_capacity(2400, DEFAULT_DAYS, mon, date!(2026 - 10 - 24)), 0);
    }

    #[test]
    fn placement() {
        let h = Horizon::new(date!(2026 - 10 - 21), 2); // Wed; weeks of 19th and 26th
        assert_eq!(place(60, None, None, DEFAULT_DAYS, &h), Placement::Unscheduled);
        assert_eq!(
            place(60, None, Some(date!(2026 - 10 - 20)), DEFAULT_DAYS, &h),
            Placement::Overdue
        );
        // Wed..Tue next week = Wed Thu Fri Mon Tue: 3 + 2 days, 100 → 20 each.
        assert_eq!(
            place(100, None, Some(date!(2026 - 10 - 27)), DEFAULT_DAYS, &h),
            Placement::Scheduled { weeks: vec![60, 40], later: 0 }
        );
        // Remainder lands on the earliest days.
        assert_eq!(
            place(7, None, Some(date!(2026 - 10 - 27)), DEFAULT_DAYS, &h),
            Placement::Scheduled { weeks: vec![5, 2], later: 0 }
        );
        // Due on a weekend with no working day in the span: all on the due date.
        assert_eq!(
            place(30, Some(date!(2026 - 10 - 24)), Some(date!(2026 - 10 - 25)), DEFAULT_DAYS, &h),
            Placement::Scheduled { weeks: vec![30, 0], later: 0 }
        );
        // Past the horizon.
        assert_eq!(
            place(50, Some(date!(2026 - 11 - 2)), Some(date!(2026 - 11 - 6)), DEFAULT_DAYS, &h),
            Placement::Scheduled { weeks: vec![0, 0], later: 50 }
        );
        // A start before today counts from today.
        assert_eq!(
            place(30, Some(date!(2026 - 10 - 1)), Some(date!(2026 - 10 - 23)), DEFAULT_DAYS, &h),
            Placement::Scheduled { weeks: vec![30, 0], later: 0 }
        );
    }

    #[test]
    fn remaining_and_shares() {
        assert_eq!(remaining(90, 46), 44);
        assert_eq!(remaining(90, 120), 0);
        assert_eq!((share(10, 3, 0), share(10, 3, 1), share(10, 3, 2)), (4, 3, 3));
        assert_eq!(share(10, 0, 0), 10);
    }
}
