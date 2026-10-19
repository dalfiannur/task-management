//! The workspace clock: every server-side "today" (default dates for time
//! entries, the workload's week, overdue and due-soon in dashboards, reports
//! and automations) is the calendar day in the workspace time zone, not UTC.
//! This module is the one place that decides it.

use domain::clock::{today_in, DEFAULT_TIMEZONE};
use persistence::Store;
use time::{Date, Duration, OffsetDateTime};

/// The workspace's IANA zone; the default when unset or no settings exist.
pub async fn workspace_timezone(store: &Store) -> anyhow::Result<String> {
    let tz: Option<Option<String>> =
        sqlx::query_scalar("SELECT timezone FROM cmp_workspacesettings WHERE singleton")
            .fetch_optional(store.pool())
            .await?;
    Ok(tz.flatten().filter(|z| !z.is_empty()).unwrap_or_else(|| DEFAULT_TIMEZONE.to_string()))
}

/// Today in the workspace zone.
pub async fn workspace_today(store: &Store) -> anyhow::Result<Date> {
    Ok(today_in(&workspace_timezone(store).await?, OffsetDateTime::now_utc()))
}

/// Today in the workspace zone, as `yyyy-MM-dd`.
pub(crate) async fn workspace_today_iso(store: &Store) -> anyhow::Result<String> {
    Ok(workspace_today(store).await?.to_string())
}

/// `days` after today in the workspace zone, as `yyyy-MM-dd`.
pub(crate) async fn workspace_date_plus(store: &Store, days: u32) -> anyhow::Result<String> {
    Ok((workspace_today(store).await? + Duration::days(days as i64)).to_string())
}
