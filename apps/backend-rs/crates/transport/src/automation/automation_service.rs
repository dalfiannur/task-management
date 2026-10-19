//! AutomationService: rule CRUD (owner/admin), enable/disable, run history
//! (members), and the admin "run the time-based rules now".

use std::collections::HashSet;
use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::automation::{name_ok, shape_error, Action, Conditions, Mode, NotifyTarget, Trigger};
use domain::task::TaskPriority;
use domain::workload::parse_date;
use persistence::Store;

use super::engine::run_scheduled;
use super::record::{
    self as rec, load_rule, rules_for_project, runs, RuleFields, RuleRecord, RunRecord,
};
use crate::notifications::Notifier;
use crate::projects::record::project_member_ids;
use crate::sedjiwa::tasks::automation::v1 as pb;
use crate::sedjiwa::tasks::automation::v1::automation_service_connect::AutomationServiceBuilder;
use crate::work::{internal, parse_pid, require_auth, require_member, require_owner_or_admin, StoreExt};

// ── proto ↔ domain ───────────────────────────────────────────────────────────

fn trigger_from(t: Option<pb::Trigger>) -> Result<Trigger, ConnectError> {
    use pb::trigger::Kind;
    let bad = || ConnectError::new_invalid_argument("pick a trigger");
    let opt = |s: Option<String>| s.filter(|s| !s.is_empty());
    Ok(match t.and_then(|t| t.kind).ok_or_else(bad)? {
        Kind::StatusChanged(s) => Trigger::StatusChanged { from: opt(s.from_status_id), to: opt(s.to_status_id) },
        Kind::TaskCreated(_) => Trigger::TaskCreated,
        Kind::AssigneeAdded(_) => Trigger::AssigneeAdded,
        Kind::SubtasksDone(_) => Trigger::SubtasksDone,
        Kind::Overdue(_) => Trigger::Overdue,
        Kind::DueIn(d) => Trigger::DueIn { days: d.days },
    })
}

fn trigger_to(t: &Trigger) -> pb::Trigger {
    use pb::trigger::Kind;
    let kind = match t {
        Trigger::StatusChanged { from, to } => Kind::StatusChanged(pb::StatusChangedTrigger {
            from_status_id: from.clone(),
            to_status_id: to.clone(),
        }),
        Trigger::TaskCreated => Kind::TaskCreated(pb::Empty {}),
        Trigger::AssigneeAdded => Kind::AssigneeAdded(pb::Empty {}),
        Trigger::SubtasksDone => Kind::SubtasksDone(pb::Empty {}),
        Trigger::Overdue => Kind::Overdue(pb::Empty {}),
        Trigger::DueIn { days } => Kind::DueIn(pb::DueInTrigger { days: *days }),
    };
    pb::Trigger { kind: Some(kind) }
}

fn action_from(a: pb::Action) -> Result<Action, ConnectError> {
    use pb::action::Kind;
    Ok(match a.kind.ok_or_else(|| ConnectError::new_invalid_argument("an action is empty"))? {
        Kind::SetStatusId(id) => Action::SetStatus { status_id: id },
        Kind::SetPriority(p) => Action::SetPriority { priority: p },
        Kind::AddLabelId(id) => Action::AddLabel { label_id: id },
        Kind::RemoveLabelId(id) => Action::RemoveLabel { label_id: id },
        Kind::AssignUserId(id) => Action::Assign { user_id: id },
        Kind::UnassignAll(_) => Action::UnassignAll,
        Kind::MoveToModuleId(id) => Action::MoveToModule { module_id: id },
        Kind::SetDueInDays(d) => Action::SetDueIn { days: d },
        Kind::Notify(n) => Action::Notify {
            target: match pb::NotifyTarget::try_from(n.target) {
                Ok(pb::NotifyTarget::Assignees) => NotifyTarget::Assignees,
                Ok(pb::NotifyTarget::Owner) => NotifyTarget::Owner,
                Ok(pb::NotifyTarget::User) => NotifyTarget::User,
                _ => return Err(ConnectError::new_invalid_argument("pick who to notify")),
            },
            user_id: n.user_id,
            message: n.message.trim().to_string(),
        },
        Kind::Comment(text) => Action::Comment { text: text.trim().to_string() },
    })
}

fn action_to(a: &Action) -> pb::Action {
    use pb::action::Kind;
    let kind = match a {
        Action::SetStatus { status_id } => Kind::SetStatusId(status_id.clone()),
        Action::SetPriority { priority } => Kind::SetPriority(priority.clone()),
        Action::AddLabel { label_id } => Kind::AddLabelId(label_id.clone()),
        Action::RemoveLabel { label_id } => Kind::RemoveLabelId(label_id.clone()),
        Action::Assign { user_id } => Kind::AssignUserId(user_id.clone()),
        Action::UnassignAll => Kind::UnassignAll(pb::Empty {}),
        Action::MoveToModule { module_id } => Kind::MoveToModuleId(module_id.clone()),
        Action::SetDueIn { days } => Kind::SetDueInDays(*days),
        Action::Notify { target, user_id, message } => Kind::Notify(pb::NotifyAction {
            target: match target {
                NotifyTarget::Assignees => pb::NotifyTarget::Assignees,
                NotifyTarget::Owner => pb::NotifyTarget::Owner,
                NotifyTarget::User => pb::NotifyTarget::User,
            } as i32,
            user_id: user_id.clone(),
            message: message.clone(),
        }),
        Action::Comment { text } => Kind::Comment(text.clone()),
    };
    pb::Action { kind: Some(kind) }
}

/// A rule's parts as the domain types (serde-tagged JSON for the MCP tools).
pub fn automation_parts(a: &pb::Automation) -> Result<(Trigger, Conditions, Vec<Action>), ConnectError> {
    let c = a.conditions.clone().unwrap_or_default();
    Ok((
        trigger_from(a.trigger.clone())?,
        Conditions { priorities: c.priorities, label_ids: c.label_ids, module_ids: c.module_ids },
        a.actions.iter().cloned().map(action_from).collect::<Result<_, _>>()?,
    ))
}

/// The inverse of [`automation_parts`], for building a save request.
pub fn automation_parts_to_proto(
    trigger: &Trigger,
    conditions: &Conditions,
    actions: &[Action],
) -> (pb::Trigger, pb::Conditions, Vec<pb::Action>) {
    (
        trigger_to(trigger),
        pb::Conditions {
            priorities: conditions.priorities.clone(),
            label_ids: conditions.label_ids.clone(),
            module_ids: conditions.module_ids.clone(),
        },
        actions.iter().map(action_to).collect(),
    )
}

fn to_proto(r: &RuleRecord) -> pb::Automation {
    pb::Automation {
        id: r.pid.to_string(),
        project_id: r.project_id.clone(),
        name: r.name.clone(),
        mode: r.mode.to_proto(),
        trigger: r.trigger.as_ref().map(trigger_to),
        conditions: Some(pb::Conditions {
            priorities: r.conditions.priorities.clone(),
            label_ids: r.conditions.label_ids.clone(),
            module_ids: r.conditions.module_ids.clone(),
        }),
        actions: r.actions.iter().map(action_to).collect(),
        created_by: r.created_by.clone(),
        updated_by: r.updated_by.clone(),
        created_at: r.created_at.clone(),
        updated_at: r.updated_at.clone(),
        run_count: r.run_count as i32,
        last_run_at: r.last_run_at.clone(),
        observed_count: r.observed_count as i32,
        last_observed_at: r.last_observed_at.clone(),
    }
}

fn run_to_proto(r: &RunRecord) -> pb::AutomationRun {
    pb::AutomationRun {
        id: r.pid.to_string(),
        automation_id: r.automation_id.clone(),
        automation_name: r.automation_name.clone(),
        task_id: r.task_id.clone(),
        task_title: r.task_title.clone(),
        task_number: r.task_number,
        trigger: r.trigger_kind.clone(),
        status: match r.status.as_str() {
            "ok" => pb::RunStatus::Ok,
            "failed" => pb::RunStatus::Failed,
            "skipped" => pb::RunStatus::Skipped,
            "observed" => pb::RunStatus::Observed,
            _ => pb::RunStatus::Unspecified,
        } as i32,
        detail: r.detail.clone(),
        created_at: r.created_at.clone(),
    }
}

// ── validation ───────────────────────────────────────────────────────────────

async fn ids_in(store: &Store, sql: &str, project_id: &str) -> Result<HashSet<String>, ConnectError> {
    Ok(sqlx::query_scalar::<_, String>(sql)
        .bind(project_id)
        .fetch_all(store.pool())
        .await
        .map_err(internal)?
        .into_iter()
        .collect())
}

/// Everything a rule refers to belongs to `project_id`.
async fn validate(
    store: &Store,
    project_id: &str,
    trigger: &Trigger,
    conditions: &Conditions,
    actions: &[Action],
) -> Result<(), ConnectError> {
    let bad = |m: &str| Err(ConnectError::new_invalid_argument(m.to_string()));
    if let Some(m) = shape_error(trigger, actions) {
        return bad(m);
    }
    let statuses = ids_in(store, "SELECT pid::text FROM cmp_taskstatusdef WHERE project_id = $1", project_id).await?;
    let labels = ids_in(store, "SELECT pid::text FROM cmp_labelinfo WHERE project_id = $1", project_id).await?;
    let modules = ids_in(store, "SELECT pid::text FROM cmp_moduleprojectref WHERE project_id = $1", project_id).await?;
    let members: HashSet<String> =
        project_member_ids(store, project_id).await.map_err(internal)?.into_iter().collect();

    if let Trigger::StatusChanged { from, to } = trigger {
        if [from, to].into_iter().flatten().any(|s| !statuses.contains(s)) {
            return bad("the trigger names a status that is not in this project");
        }
    }
    if conditions.priorities.iter().any(|p| TaskPriority::parse(p).is_none()) {
        return bad("unknown priority in the conditions");
    }
    if conditions.label_ids.iter().any(|l| !labels.contains(l)) {
        return bad("a condition names a label that is not in this project");
    }
    if conditions.module_ids.iter().any(|m| !modules.contains(m)) {
        return bad("a condition names a module that is not in this project");
    }
    for a in actions {
        let ok = match a {
            Action::SetStatus { status_id } => statuses.contains(status_id),
            Action::SetPriority { priority } => TaskPriority::parse(priority).is_some(),
            Action::AddLabel { label_id } | Action::RemoveLabel { label_id } => labels.contains(label_id),
            Action::Assign { user_id } => user_id.is_empty() || members.contains(user_id),
            Action::MoveToModule { module_id } => modules.contains(module_id),
            Action::Notify { target: NotifyTarget::User, user_id, .. } => members.contains(user_id),
            _ => true,
        };
        if !ok {
            return bad("an action names a status, label, module or person that is not in this project");
        }
    }
    Ok(())
}

struct Parsed {
    name: String,
    trigger: Trigger,
    conditions: Conditions,
    actions: Vec<Action>,
}

fn parse(r: &pb::SaveAutomationRequest) -> Result<Parsed, ConnectError> {
    let name = r.name.trim().to_string();
    if !name_ok(&name) {
        return Err(ConnectError::new_invalid_argument("name must be 1–80 characters"));
    }
    let c = r.conditions.clone().unwrap_or_default();
    Ok(Parsed {
        name,
        trigger: trigger_from(r.trigger.clone())?,
        conditions: Conditions { priorities: c.priorities, label_ids: c.label_ids, module_ids: c.module_ids },
        actions: r.actions.iter().cloned().map(action_from).collect::<Result<_, _>>()?,
    })
}

async fn require_rule(store: &Store, id: &str) -> Result<RuleRecord, ConnectError> {
    load_rule(store, parse_pid(id)?)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("automation not found"))
}

fn now() -> String {
    crate::timelog::record::now_iso()
}

// ── handlers ─────────────────────────────────────────────────────────────────

pub async fn list_automations_core(
    store: &Store,
    auth: &AuthUser,
    r: pb::ListAutomationsRequest,
) -> Result<pb::ListAutomationsResponse, ConnectError> {
    require_member(&store, &r.project_id, &auth).await?;
    let rules = rules_for_project(&store, &r.project_id).await.map_err(internal)?;
    Ok(pb::ListAutomationsResponse { automations: rules.iter().map(to_proto).collect() })
}

async fn list_automations(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListAutomationsRequest>,
) -> Result<ConnectResponse<pb::ListAutomationsResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    Ok(ConnectResponse::new(list_automations_core(&store, &auth, r).await?))
}

/// One rule by id, member-gated like the list. Backs no RPC: the MCP tools
/// read a rule this way before a partial update.
pub async fn get_automation_core(
    store: &Store,
    auth: &AuthUser,
    id: &str,
) -> Result<pb::Automation, ConnectError> {
    let rule = require_rule(store, id).await?;
    require_member(store, &rule.project_id, auth).await?;
    Ok(to_proto(&rule))
}

pub async fn create_automation_core(
    store: &Store,
    auth: &AuthUser,
    r: pb::SaveAutomationRequest,
) -> Result<pb::Automation, ConnectError> {
    require_member(&store, &r.project_id, &auth).await?;
    require_owner_or_admin(&store, &r.project_id, &auth).await?;
    let mode = Mode::from_proto(r.mode)
        .ok_or_else(|| ConnectError::new_invalid_argument("pick a mode: off, observe or on"))?;
    let p = parse(&r)?;
    validate(&store, &r.project_id, &p.trigger, &p.conditions, &p.actions).await?;
    let now = now();
    let pid = rec::create_rule(
        &store,
        &r.project_id,
        &auth.id,
        mode,
        RuleFields { name: &p.name, trigger: &p.trigger, conditions: &p.conditions, actions: &p.actions, now: &now },
    )
    .await
    .map_err(internal)?;
    Ok(to_proto(&require_rule(&store, &pid.to_string()).await?))
}

async fn create_automation(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::SaveAutomationRequest>,
) -> Result<ConnectResponse<pb::Automation>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    Ok(ConnectResponse::new(create_automation_core(&store, &auth, r).await?))
}

pub async fn update_automation_core(
    store: &Store,
    auth: &AuthUser,
    r: pb::SaveAutomationRequest,
) -> Result<pb::Automation, ConnectError> {
    let rule = require_rule(&store, &r.id).await?;
    require_member(&store, &rule.project_id, &auth).await?;
    require_owner_or_admin(&store, &rule.project_id, &auth).await?;
    let p = parse(&r)?;
    validate(&store, &rule.project_id, &p.trigger, &p.conditions, &p.actions).await?;
    let now = now();
    rec::update_rule(
        &store,
        rule.pid,
        &auth.id,
        RuleFields { name: &p.name, trigger: &p.trigger, conditions: &p.conditions, actions: &p.actions, now: &now },
    )
    .await
    .map_err(internal)?;
    Ok(to_proto(&require_rule(&store, &r.id).await?))
}

async fn update_automation(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::SaveAutomationRequest>,
) -> Result<ConnectResponse<pb::Automation>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    Ok(ConnectResponse::new(update_automation_core(&store, &auth, r).await?))
}

pub async fn delete_automation_core(
    store: &Store,
    auth: &AuthUser,
    r: pb::DeleteAutomationRequest,
) -> Result<pb::DeleteAutomationResponse, ConnectError> {
    let rule = require_rule(&store, &r.id).await?;
    require_member(&store, &rule.project_id, &auth).await?;
    require_owner_or_admin(&store, &rule.project_id, &auth).await?;
    rec::delete_rule(&store, rule.pid).await.map_err(internal)?;
    Ok(pb::DeleteAutomationResponse { ok: true })
}

async fn delete_automation(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::DeleteAutomationRequest>,
) -> Result<ConnectResponse<pb::DeleteAutomationResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    Ok(ConnectResponse::new(delete_automation_core(&store, &auth, r).await?))
}

pub async fn set_automation_mode_core(
    store: &Store,
    auth: &AuthUser,
    r: pb::SetAutomationModeRequest,
) -> Result<pb::Automation, ConnectError> {
    let rule = require_rule(&store, &r.id).await?;
    require_member(&store, &rule.project_id, &auth).await?;
    require_owner_or_admin(&store, &rule.project_id, &auth).await?;
    let mode = Mode::from_proto(r.mode)
        .ok_or_else(|| ConnectError::new_invalid_argument("pick a mode: off, observe or on"))?;
    rec::set_mode(&store, rule.pid, mode, &auth.id, &now()).await.map_err(internal)?;
    Ok(to_proto(&require_rule(&store, &r.id).await?))
}

async fn set_automation_mode(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::SetAutomationModeRequest>,
) -> Result<ConnectResponse<pb::Automation>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    Ok(ConnectResponse::new(set_automation_mode_core(&store, &auth, r).await?))
}

pub async fn list_automation_runs_core(
    store: &Store,
    auth: &AuthUser,
    r: pb::ListAutomationRunsRequest,
) -> Result<pb::ListAutomationRunsResponse, ConnectError> {
    require_member(&store, &r.project_id, &auth).await?;
    let limit = match r.limit {
        0 => 50,
        n if n < 0 => return Err(ConnectError::new_invalid_argument("limit must be positive")),
        n => n.min(200),
    };
    let rows = runs(&store, &r.project_id, r.automation_id.as_deref().filter(|s| !s.is_empty()), limit as i64)
        .await
        .map_err(internal)?;
    Ok(pb::ListAutomationRunsResponse { runs: rows.iter().map(run_to_proto).collect() })
}

async fn list_automation_runs(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListAutomationRunsRequest>,
) -> Result<ConnectResponse<pb::ListAutomationRunsResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    Ok(ConnectResponse::new(list_automation_runs_core(&store, &auth, r).await?))
}

async fn run_scheduled_automations(
    Extension(store): StoreExt,
    notifier: Option<Extension<Arc<Notifier>>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::RunScheduledAutomationsRequest>,
) -> Result<ConnectResponse<pb::RunScheduledAutomationsResponse>, ConnectError> {
    let auth = require_auth(user)?;
    if !auth.is_admin() {
        return Err(ConnectError::new_permission_denied("admin required"));
    }
    let ConnectRequest(r) = req;
    let today = match r.today.as_deref().filter(|s| !s.is_empty()) {
        Some(s) => parse_date(s)
            .filter(|_| s.len() == 10)
            .ok_or_else(|| ConnectError::new_invalid_argument("today must be yyyy-MM-dd"))?,
        None => crate::clock::workspace_today(&store).await.map_err(internal)?,
    };
    let n = notifier.map(|Extension(n)| n);
    let runs = run_scheduled(&store, n.as_ref(), today).await.map_err(internal)?;
    Ok(ConnectResponse::new(pb::RunScheduledAutomationsResponse { runs }))
}

/// AutomationService router; injects the Store as a request extension.
pub fn automation_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    type N = Option<Extension<Arc<Notifier>>>;
    AutomationServiceBuilder::<()>::new()
        .list_automations::<_, (StoreExt, A, ConnectRequest<pb::ListAutomationsRequest>)>(list_automations)
        .create_automation::<_, (StoreExt, A, ConnectRequest<pb::SaveAutomationRequest>)>(create_automation)
        .update_automation::<_, (StoreExt, A, ConnectRequest<pb::SaveAutomationRequest>)>(update_automation)
        .delete_automation::<_, (StoreExt, A, ConnectRequest<pb::DeleteAutomationRequest>)>(delete_automation)
        .set_automation_mode::<_, (StoreExt, A, ConnectRequest<pb::SetAutomationModeRequest>)>(
            set_automation_mode,
        )
        .list_automation_runs::<_, (StoreExt, A, ConnectRequest<pb::ListAutomationRunsRequest>)>(
            list_automation_runs,
        )
        .run_scheduled_automations::<_, (StoreExt, N, A, ConnectRequest<pb::RunScheduledAutomationsRequest>)>(
            run_scheduled_automations,
        )
        .build()
        .layer(Extension(store))
}
