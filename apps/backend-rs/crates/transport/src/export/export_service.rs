//! ExportService: the synchronous CSV path. Owner/admin only.

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use persistence::Store;

use super::csv::tasks_csv;
use super::gather::gather;
use super::{file_slug, internal, parse_pid, require_auth, require_owner_or_admin, require_project, StoreExt};
use crate::sedjiwa::tasks::export::v1 as pb;
use crate::sedjiwa::tasks::export::v1::export_service_connect::ExportServiceBuilder;

async fn export_tasks_csv(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ExportTasksCsvRequest>,
) -> Result<ConnectResponse<pb::ExportTasksCsvResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.project_id)?;
    let project = require_project(&store, pid).await?;
    require_owner_or_admin(&auth, &project)?;

    let snapshot = gather(&store, &r.project_id).await.map_err(internal)?;
    Ok(ConnectResponse::new(pb::ExportTasksCsvResponse {
        csv: tasks_csv(&snapshot),
        file_name: format!("{}-tasks.csv", file_slug(&project.name)),
    }))
}

/// ExportService router; injects the Store as a request extension.
pub fn export_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    ExportServiceBuilder::<()>::new()
        .export_tasks_csv::<_, (StoreExt, A, ConnectRequest<pb::ExportTasksCsvRequest>)>(
            export_tasks_csv,
        )
        .build()
        .layer(Extension(store))
}
