//! ReportService: one RPC, one window, four sections.

use std::collections::HashMap;
use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use persistence::Store;

use super::activity_summary::activity_summary;
use super::aggregate::{completed_list, overdue_list, per_member, per_project, totals};
use super::window::{DateWindow, Window};
use super::{internal, require_auth, StoreExt};
use crate::dashboard::context::{today, Context};
use crate::sedjiwa::tasks::reports::v1 as pb;
use crate::sedjiwa::tasks::reports::v1::report_service_connect::ReportServiceBuilder;
use crate::users::record::load_all_users;

/// Cap on the task lists. A month of completed work is readable; a year of it
/// is a data dump, and the page says when it truncated.
const DEFAULT_LIST_LIMIT: u32 = 50;

async fn get_period_report(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::GetPeriodReportRequest>,
) -> Result<ConnectResponse<pb::PeriodReport>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let limit = if r.list_limit == 0 { DEFAULT_LIST_LIMIT } else { r.list_limit } as usize;
    Ok(ConnectResponse::new(build_report(&store, &auth, &r, limit).await?))
}

/// The report as an .xlsx workbook. Built from the same `build_report` as the
/// page, so the two cannot disagree — except that the task lists are complete.
async fn export_period_report_xlsx(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ExportPeriodReportXlsxRequest>,
) -> Result<ConnectResponse<pb::ExportPeriodReportXlsxResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let request = r
        .report
        .ok_or_else(|| ConnectError::new_invalid_argument("report is required"))?;
    let granularity = match r.granularity.as_str() {
        "weekly" | "monthly" => r.granularity.clone(),
        _ => return Err(ConnectError::new_invalid_argument("granularity must be weekly or monthly")),
    };
    let report = build_report(&store, &auth, &request, usize::MAX).await?;
    let by = crate::users::record::load_user(&store, auth.id.parse().unwrap_or(0))
        .await
        .map_err(internal)?
        .map(|u| u.display_name)
        .unwrap_or_default();
    let xlsx = super::xlsx::workbook(
        &report,
        &super::xlsx::Meta {
            granularity: &granularity,
            label: &r.label,
            by: &by,
            app_name: &r.app_name,
            utc_offset_minutes: r.utc_offset_minutes,
        },
    )
    .map_err(internal)?;
    Ok(ConnectResponse::new(pb::ExportPeriodReportXlsxResponse {
        xlsx,
        file_name: format!("report-{granularity}-{}.xlsx", request.period_start_date),
    }))
}

/// Validate the request and assemble the report; task lists capped at `limit`.
async fn build_report(
    store: &Store,
    auth: &AuthUser,
    r: &pb::GetPeriodReportRequest,
    limit: usize,
) -> Result<pb::PeriodReport, ConnectError> {
    let window = Window::parse(&r.period_start, &r.period_end).ok_or_else(|| {
        ConnectError::new_invalid_argument(
            "period_start and period_end must be RFC3339 instants with period_start < period_end",
        )
    })?;
    // The same period as plain local dates, for `start_date`. Required, not
    // optional: falling back to the instants would be wrong by a day at both
    // ends, and falling back to `created_at` for every task would change what
    // the number means with nothing on the page to say so.
    let date_window = DateWindow::parse(&r.period_start_date, &r.period_end_date).ok_or_else(|| {
        ConnectError::new_invalid_argument(
            "period_start_date and period_end_date must be yyyy-MM-dd dates with start < end",
        )
    })?;
    // A comparison window is optional, but a malformed one is still an error:
    // silently dropping it would show the page "no comparison" for a bug.
    let prev = if r.prev_start.is_empty() && r.prev_end.is_empty() {
        None
    } else {
        Some(Window::parse(&r.prev_start, &r.prev_end).ok_or_else(|| {
            ConnectError::new_invalid_argument(
                "prev_start and prev_end must both be empty, or a valid window",
            )
        })?)
    };
    // The comparison window's dates travel with it: a caller that asks for a
    // comparison but omits its dates would get a `started` count for the
    // previous period computed against the current period's dates.
    let prev_dates = match &prev {
        None => None,
        Some(_) => Some(
            DateWindow::parse(&r.prev_start_date, &r.prev_end_date).ok_or_else(|| {
                ConnectError::new_invalid_argument(
                    "prev_start_date and prev_end_date are required whenever a comparison window is given",
                )
            })?,
        ),
    };
    let ctx = Context::load(store, auth).await.map_err(internal)?;
    let today = today();
    let scoped = ctx.scoped_tasks();

    let names: HashMap<String, String> = load_all_users(store)
        .await
        .map_err(internal)?
        .into_iter()
        .map(|u| (u.pid.to_string(), u.display_name))
        .collect();

    let (completed_tasks, completed_truncated) = completed_list(&ctx, &window, limit);
    let (overdue_tasks, overdue_truncated) = overdue_list(&ctx, &today, limit);
    let (activity_summary_rows, activity_total) =
        activity_summary(store, ctx.scope.as_ref(), &window).await.map_err(internal)?;

    Ok(pb::PeriodReport {
        // `Window::start`/`end` are the truncated 19-character form with no
        // zone designator (`"2026-09-07T00:00:00"`); echoed as-is, a JS
        // `Date` would parse that as *local* time, not the UTC instant it
        // actually is. Append `Z` so what goes out is genuinely RFC3339 UTC.
        period_start: format!("{}Z", window.start()),
        period_end: format!("{}Z", window.end()),
        totals: Some(totals(&scoped, &window, &date_window, &today)),
        prev_totals: prev
            .as_ref()
            .zip(prev_dates.as_ref())
            .map(|(w, dw)| totals(&scoped, w, dw, &today)),
        per_project: per_project(&ctx, &window, &date_window, &today),
        per_member: per_member(&ctx, &window, &date_window, &today, &names),
        completed_tasks,
        completed_truncated,
        overdue_tasks,
        overdue_truncated,
        activity_summary: activity_summary_rows,
        activity_total,
    })
}

/// ReportService router; injects the Store as a request extension.
pub fn report_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    ReportServiceBuilder::<()>::new()
        .get_period_report::<_, (StoreExt, A, ConnectRequest<pb::GetPeriodReportRequest>)>(
            get_period_report,
        )
        .export_period_report_xlsx::<_, (StoreExt, A, ConnectRequest<pb::ExportPeriodReportXlsxRequest>)>(
            export_period_report_xlsx,
        )
        .build()
        .layer(Extension(store))
}
