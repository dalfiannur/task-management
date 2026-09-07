//! ReportService: one RPC, one window, four sections.

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use persistence::Store;

use super::window::Window;
use super::{require_auth, StoreExt};
use crate::sedjiwa::tasks::reports::v1 as pb;
use crate::sedjiwa::tasks::reports::v1::report_service_connect::ReportServiceBuilder;

/// Cap on the task lists. A month of completed work is readable; a year of it
/// is a data dump, and the page says when it truncated.
const DEFAULT_LIST_LIMIT: u32 = 50;

async fn get_period_report(
    Extension(_store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::GetPeriodReportRequest>,
) -> Result<ConnectResponse<pb::PeriodReport>, ConnectError> {
    let _auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let window = Window::parse(&r.period_start, &r.period_end).ok_or_else(|| {
        ConnectError::new_invalid_argument(
            "period_start and period_end must be RFC3339 instants with period_start < period_end",
        )
    })?;
    let _limit = if r.list_limit == 0 { DEFAULT_LIST_LIMIT } else { r.list_limit };

    Ok(ConnectResponse::new(pb::PeriodReport {
        period_start: window.start().to_string(),
        period_end: window.end().to_string(),
        ..Default::default()
    }))
}

/// ReportService router; injects the Store as a request extension.
pub fn report_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    ReportServiceBuilder::<()>::new()
        .get_period_report::<_, (StoreExt, A, ConnectRequest<pb::GetPeriodReportRequest>)>(
            get_period_report,
        )
        .build()
        .layer(Extension(store))
}
