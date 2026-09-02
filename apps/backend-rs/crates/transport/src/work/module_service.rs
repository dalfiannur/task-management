//! ModuleService: list (member) + create/update/delete/reorder (owner/admin).

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::module::{
    module_name_ok, ModuleDescription, ModuleName, ModuleOrder, ModuleProjectRef,
};
use persistence::Store;

use super::record::{load_module, modules_for_project, to_proto, ModuleRecord};
use super::task_record::task_pids_for_module;
use super::{
    internal, parse_pid, require_auth, require_member, require_owner_or_admin, StoreExt,
};
use crate::activity::record;
use crate::sedjiwa::tasks::work::v1 as pb;
use crate::sedjiwa::tasks::work::v1::module_service_connect::ModuleServiceBuilder;
use domain::activity::{ActivityAction, EntityType};

fn list_response(modules: &[ModuleRecord]) -> pb::ListModulesResponse {
    pb::ListModulesResponse {
        modules: modules.iter().map(to_proto).collect(),
    }
}

/// Load a module or `not_found`.
async fn require_module(store: &Store, pid: i64) -> Result<ModuleRecord, ConnectError> {
    load_module(store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("module not found"))
}

/// All modules in a project. Member-gated.
pub async fn list_modules_core(
    store: &Store,
    auth: &AuthUser,
    r: pb::ListModulesRequest,
) -> Result<pb::ListModulesResponse, ConnectError> {
    require_member(store, &r.project_id, auth).await?;
    let modules = modules_for_project(store, &r.project_id)
        .await
        .map_err(internal)?;
    Ok(list_response(&modules))
}

async fn list_modules(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListModulesRequest>,
) -> Result<ConnectResponse<pb::ListModulesResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    Ok(ConnectResponse::new(
        list_modules_core(&store, &auth, r).await?,
    ))
}

async fn create_module(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::CreateModuleRequest>,
) -> Result<ConnectResponse<pb::Module>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    require_owner_or_admin(&store, &r.project_id, &auth).await?;
    let name = r.name.trim();
    if !module_name_ok(name) {
        return Err(ConnectError::new_invalid_argument("name is required"));
    }
    let existing = modules_for_project(&store, &r.project_id)
        .await
        .map_err(internal)?;
    let next_order = existing.iter().map(|m| m.order).max().map(|m| m + 1).unwrap_or(0);

    let pid = store
        .create((
            ModuleName {
                value: name.to_string(),
            },
            ModuleProjectRef {
                project_id: r.project_id.clone(),
            },
            ModuleOrder { value: next_order },
        ))
        .await
        .map_err(internal)?;
    if let Some(desc) = r
        .description
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty())
    {
        store
            .update(pid, move |w, e| {
                w.insert(e, ModuleDescription { value: desc });
            })
            .await
            .map_err(internal)?;
    }
    record(
        &store,
        &r.project_id,
        &auth.id,
        EntityType::Module,
        &pid.to_string(),
        ActivityAction::Created,
        format!("created module '{name}'"),
        vec![],
    )
    .await;
    let m = require_module(&store, pid).await?;
    Ok(ConnectResponse::new(to_proto(&m)))
}

async fn update_module(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::UpdateModuleRequest>,
) -> Result<ConnectResponse<pb::Module>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let m = require_module(&store, pid).await?;
    require_owner_or_admin(&store, &m.project_id, &auth).await?;

    if let Some(name) = &r.name {
        if !module_name_ok(name) {
            return Err(ConnectError::new_invalid_argument("name cannot be blank"));
        }
    }
    let name = r.name.map(|n| n.trim().to_string());
    let desc = r.description.map(|d| d.trim().to_string());
    store
        .update(pid, move |w, e| {
            if let Some(n) = name {
                w.remove::<ModuleName>(e);
                w.insert(e, ModuleName { value: n });
            }
            if let Some(d) = desc {
                w.remove::<ModuleDescription>(e);
                if !d.is_empty() {
                    w.insert(e, ModuleDescription { value: d });
                }
            }
        })
        .await
        .map_err(internal)?;
    let m = require_module(&store, pid).await?;
    record(
        &store,
        &m.project_id,
        &auth.id,
        EntityType::Module,
        &pid.to_string(),
        ActivityAction::Updated,
        format!("updated module '{}'", m.name),
        vec![],
    )
    .await;
    Ok(ConnectResponse::new(to_proto(&m)))
}

async fn delete_module(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::DeleteModuleRequest>,
) -> Result<ConnectResponse<pb::DeleteModuleResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let m = require_module(&store, pid).await?;
    require_owner_or_admin(&store, &m.project_id, &auth).await?;
    // Cascade: delete the module's tasks, then the module.
    for tpid in task_pids_for_module(&store, &pid.to_string())
        .await
        .map_err(internal)?
    {
        store.delete(tpid).await.map_err(internal)?;
        // The cascade deletes entities but the index does not follow on its
        // own; without this, every task under a deleted module stays findable.
        super::deindex_task_and_comments(&store, &tpid.to_string()).await;
    }
    store.delete(pid).await.map_err(internal)?;
    record(
        &store,
        &m.project_id,
        &auth.id,
        EntityType::Module,
        &pid.to_string(),
        ActivityAction::Deleted,
        format!("deleted module '{}'", m.name),
        vec![],
    )
    .await;
    Ok(ConnectResponse::new(pb::DeleteModuleResponse { ok: true }))
}

async fn reorder_modules(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ReorderModulesRequest>,
) -> Result<ConnectResponse<pb::ListModulesResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    require_owner_or_admin(&store, &r.project_id, &auth).await?;
    for (idx, mid) in r.module_ids.iter().enumerate() {
        let Ok(mpid) = mid.parse::<i64>() else {
            continue;
        };
        // Only reorder modules that belong to this project.
        match load_module(&store, mpid).await.map_err(internal)? {
            Some(m) if m.project_id == r.project_id => {
                let order = idx as i32;
                store
                    .update(mpid, move |w, e| {
                        w.remove::<ModuleOrder>(e);
                        w.insert(e, ModuleOrder { value: order });
                    })
                    .await
                    .map_err(internal)?;
            }
            _ => continue,
        }
    }
    record(
        &store,
        &r.project_id,
        &auth.id,
        EntityType::Module,
        &r.project_id,
        ActivityAction::Updated,
        "reordered modules".to_string(),
        vec![],
    )
    .await;
    let modules = modules_for_project(&store, &r.project_id)
        .await
        .map_err(internal)?;
    Ok(ConnectResponse::new(list_response(&modules)))
}

/// ModuleService router; injects the Store as a request extension.
pub fn module_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    ModuleServiceBuilder::<()>::new()
        .list_modules::<_, (StoreExt, A, ConnectRequest<pb::ListModulesRequest>)>(list_modules)
        .create_module::<_, (StoreExt, A, ConnectRequest<pb::CreateModuleRequest>)>(create_module)
        .update_module::<_, (StoreExt, A, ConnectRequest<pb::UpdateModuleRequest>)>(update_module)
        .delete_module::<_, (StoreExt, A, ConnectRequest<pb::DeleteModuleRequest>)>(delete_module)
        .reorder_modules::<_, (StoreExt, A, ConnectRequest<pb::ReorderModulesRequest>)>(
            reorder_modules,
        )
        .build()
        .layer(Extension(store))
}
