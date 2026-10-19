//! The workspace day: "today" as the team's calendar has it, from an IANA
//! time zone, not UTC. Pure — the zone name comes from the workspace
//! settings, the instant from the caller.

use time::{Date, OffsetDateTime};
use time_tz::{timezones, OffsetDateTimeExt, TimeZone};

/// Used when the workspace has not chosen a zone.
pub const DEFAULT_TIMEZONE: &str = "Asia/Jakarta";

/// A name the tz database knows, e.g. `Asia/Jakarta` or `UTC`.
pub fn timezone_ok(name: &str) -> bool {
    timezones::get_by_name(name).is_some()
}

/// Every zone name `timezone_ok` accepts (aliases such as Asia/Calcutta
/// included), sorted. Clients pick from this list so they can never offer a
/// zone the server refuses.
pub fn supported_timezones() -> Vec<&'static str> {
    let mut names: Vec<&'static str> = timezones::iter().map(|t| t.name()).collect();
    names.sort_unstable();
    names.dedup();
    names
}

/// The calendar day at `now` in `zone`; an unknown zone falls back to the
/// default rather than to UTC.
pub fn today_in(zone: &str, now: OffsetDateTime) -> Date {
    let tz = timezones::get_by_name(zone)
        .or_else(|| timezones::get_by_name(DEFAULT_TIMEZONE))
        .expect("the default zone is in the tz database");
    now.to_timezone(tz).date()
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::{date, datetime};

    #[test]
    fn workspace_day_is_local() {
        // 23:30 UTC on the 20th is 06:30 on the 21st in Jakarta (UTC+7).
        let now = datetime!(2026-10-20 23:30 UTC);
        assert_eq!(today_in("Asia/Jakarta", now), date!(2026 - 10 - 21));
        assert_eq!(today_in("UTC", now), date!(2026 - 10 - 20));
        assert_eq!(today_in("America/New_York", now), date!(2026 - 10 - 20));
        assert_eq!(today_in("Not/AZone", now), date!(2026 - 10 - 21), "unknown → the default zone");
    }

    #[test]
    fn supported_list_is_exactly_what_is_accepted() {
        let all = supported_timezones();
        assert!(all.len() > 400 && all.windows(2).all(|w| w[0] < w[1]));
        assert!(all.iter().all(|z| timezone_ok(z)));
        for z in ["Asia/Jakarta", "UTC", "Asia/Kolkata", "Asia/Calcutta", "Etc/GMT+12"] {
            assert!(all.contains(&z), "{z} is offered");
        }
    }

    #[test]
    fn zone_names() {
        assert!(timezone_ok("Asia/Jakarta") && timezone_ok("UTC") && timezone_ok("Europe/Amsterdam"));
        assert!(!timezone_ok("Asia/Atlantis") && !timezone_ok("") && !timezone_ok("+07:00"));
    }
}

