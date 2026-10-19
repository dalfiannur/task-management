//! The automation engine: matches a task change against the project's rules
//! and runs their actions through the same core functions the RPCs use, so
//! validation, activity, notifications and search come along.
//!
//! Actions run as the project's **Automation** identity
//! (`AuthUser::automation`): a member of the rule's project for the length of
//! the run and nothing more, so a rule never does what needs an owner or an
//! admin, never reaches another project, and keeps working after whoever
//! wrote it leaves. Rows it writes — activity, comments, notifications — are
//! tagged with the rule's id through the task-local [`Chain`].
//!
//! A rule in **observe** mode matches exactly like one that is on, changes
//! nothing, and records one OBSERVED run saying what it would have done. It
//! neither chains nor spends the action budget.
//!
//! Chaining is bounded by the same [`Chain`]: a person's change is depth 0;
//! actions run at depth + 1, and a change made at depth 1 may only trigger
//! further rules through status changes and subtask completion (see
//! `domain::automation::may_chain`). One root change shares one action
//! budget across the whole chain.

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use auth::AuthUser;
use domain::automation::{
    fires_on, matches, may_chain, Action, Event, Mode, NotifyTarget, TaskFacts, Trigger,
    MAX_ACTIONS_PER_EVENT,
};
use domain::notification::NotificationType;
use domain::task::{TaskPriority, TaskStatus};
use domain::workload::format_date;
use persistence::Store;
use time::{Date, Duration, OffsetDateTime};

use super::record::{
    active_rules, all_subtasks_done, claim_fired, insert_run, open_tasks_due_between,
    system_actor_id, NewRun, RuleRecord,
};
use crate::comments::comment_service::create_comment_core;
use crate::notifications::{emit, NotifRefs, Notifier};
use crate::projects::record::{is_member, load_project};
use crate::templates::record::template_project_ids;
use crate::sedjiwa::tasks::comment::v1 as comment_pb;
use crate::sedjiwa::tasks::work::v1 as work_pb;
use crate::work::task_record::{load_task, TaskRecord};
use crate::work::task_service::{move_task_core, update_task_core};

/// Triggers a change can fire (the rest are time-based).
const CHANGE_KINDS: [&str; 4] = ["status_changed", "task_created", "assignee_added", "subtasks_done"];

#[derive(Clone)]
struct Chain {
    depth: u8,
    budget: Arc<AtomicUsize>,
    /// The rule whose actions are running, for provenance.
    rule: Option<i64>,
}

tokio::task_local! {
    static CHAIN: Chain;
}

fn current_chain() -> Chain {
    CHAIN.try_with(Chain::clone).unwrap_or_else(|_| Chain {
        depth: 0,
        budget: Arc::new(AtomicUsize::new(MAX_ACTIONS_PER_EVENT)),
        rule: None,
    })
}

/// The automation rule whose actions are running right now, if any. Record
/// writers tag what they write with it; a person's change has none.
pub(crate) fn current_rule() -> Option<i64> {
    CHAIN.try_with(|c| c.rule).ok().flatten()
}

fn event_kind(e: &Event) -> &'static str {
    match e {
        Event::Created => "task_created",
        Event::StatusChanged { .. } => "status_changed",
        Event::AssigneeAdded => "assignee_added",
        Event::SubtasksDone => "subtasks_done",
    }
}

/// Today in the workspace zone (UTC only if the settings can't be read).
async fn workspace_day(store: &Store) -> Date {
    match crate::clock::workspace_today(store).await {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!(error = %e, "workspace clock unavailable, using UTC");
            OffsetDateTime::now_utc().date()
        }
    }
}

/// The changes between two states of one task, as automation events.
pub(crate) fn events_between(old: &TaskRecord, new: &TaskRecord) -> Vec<Event> {
    let mut out = Vec::new();
    if old.status_id != new.status_id && !new.status_id.is_empty() {
        out.push(Event::StatusChanged { from: old.status_id.clone(), to: new.status_id.clone() });
    }
    if new.assignee_ids.iter().any(|a| !old.assignee_ids.contains(a)) {
        out.push(Event::AssigneeAdded);
    }
    out
}

/// Run the rules a person's (or an automation's) change triggers. Never
/// fails the change: problems land in the rule's run history or the log.
pub(crate) fn after_change<'a>(
    store: &'a Store,
    notifier: Option<&'a Arc<Notifier>>,
    project_id: &'a str,
    task_id: &'a str,
    events: Vec<Event>,
) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>> {
    // Boxed with a named type: actions call back into the task cores, which
    // call here, and an `async fn` cannot name its own recursive future.
    Box::pin(after_change_inner(store, notifier, project_id, task_id, events))
}

async fn after_change_inner(
    store: &Store,
    notifier: Option<&Arc<Notifier>>,
    project_id: &str,
    task_id: &str,
    events: Vec<Event>,
) {
    let chain = current_chain();
    let events: Vec<Event> = events.into_iter().filter(|e| may_chain(chain.depth, e)).collect();
    if events.is_empty() {
        return;
    }
    // A template project's tasks are blueprints: no rule acts on them.
    match template_project_ids(store).await {
        Ok(t) if t.iter().any(|p| p == project_id) => return,
        Ok(_) => {}
        Err(e) => {
            tracing::warn!(error = %e, "failed to load template projects");
            return;
        }
    }
    let rules = match active_rules(store, Some(project_id), &CHANGE_KINDS).await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, project = %project_id, "failed to load automations");
            return;
        }
    };
    let today = workspace_day(store).await;
    for rule in &rules {
        for e in &events {
            if !rule.trigger.as_ref().is_some_and(|t| fires_on(t, e)) {
                continue;
            }
            if rule.mode == Mode::Observe {
                observe_rule(store, rule, task_id, event_kind(e), today).await;
                continue;
            }
            let next = Chain { depth: chain.depth + 1, budget: chain.budget.clone(), rule: Some(rule.pid) };
            CHAIN.scope(next, run_rule(store, notifier, rule, task_id, event_kind(e), today)).await;
        }
    }
}

/// After a task reached Done: if it is a subtask and its siblings are all
/// done too, that is a `subtasks_done` change on the parent.
pub(crate) async fn after_done(
    store: &Store,
    notifier: Option<&Arc<Notifier>>,
    project_id: &str,
    task: &TaskRecord,
) {
    let Some(parent) = task.parent_id.as_deref() else { return };
    match all_subtasks_done(store, parent).await {
        Ok(true) => after_change(store, notifier, project_id, parent, vec![Event::SubtasksDone]).await,
        Ok(false) => {}
        Err(e) => tracing::warn!(error = %e, task = %parent, "subtask check failed"),
    }
}

/// Hooks for the task cores: one call after a create, one after an update.
pub(crate) async fn task_created(store: &Store, notifier: Option<&Arc<Notifier>>, project_id: &str, task: &TaskRecord) {
    let mut events = vec![Event::Created];
    if !task.assignee_ids.is_empty() {
        events.push(Event::AssigneeAdded);
    }
    after_change(store, notifier, project_id, &task.pid.to_string(), events).await;
}

pub(crate) async fn task_updated(
    store: &Store,
    notifier: Option<&Arc<Notifier>>,
    project_id: &str,
    old: &TaskRecord,
    new: &TaskRecord,
) {
    let events = events_between(old, new);
    after_change(store, notifier, project_id, &new.pid.to_string(), events).await;
    if new.status == TaskStatus::Done && old.status != TaskStatus::Done {
        after_done(store, notifier, project_id, new).await;
    }
}

fn facts(t: &TaskRecord) -> TaskFacts {
    TaskFacts {
        priority: t.priority.as_str().to_string(),
        label_ids: t.label_ids.clone(),
        module_id: t.module_id.clone(),
    }
}

/// The task, if it exists and the rule's conditions hold for it now.
async fn matching_task(store: &Store, rule: &RuleRecord, task_id: &str) -> Option<TaskRecord> {
    let pid = task_id.parse::<i64>().ok()?;
    let task = load_task(store, pid).await.ok()??;
    matches(&rule.conditions, &facts(&task)).then_some(task)
}

async fn record_run(store: &Store, rule: &RuleRecord, task_id: &str, trigger_kind: &str, status: &str, detail: &str) {
    let now = crate::timelog::record::now_iso();
    if let Err(e) = insert_run(
        store,
        NewRun { automation_id: rule.pid, project_id: &rule.project_id, task_id, trigger_kind, status, detail, now: &now },
    )
    .await
    {
        tracing::warn!(error = %e, rule = rule.pid, "failed to record an automation run");
    }
}

/// Run one rule on one task (conditions permitting) and record the run.
/// `true` when it ran (whatever the outcome). Runs inside the rule's
/// [`Chain`] scope.
async fn run_rule(
    store: &Store,
    notifier: Option<&Arc<Notifier>>,
    rule: &RuleRecord,
    task_id: &str,
    trigger_kind: &str,
    today: Date,
) -> bool {
    if matching_task(store, rule, task_id).await.is_none() {
        return false;
    }
    let budget = current_chain().budget;
    let mut done: Vec<String> = Vec::new();
    let mut status = "ok";
    match actor_for(store, rule).await {
        Ok(actor) => {
            for action in &rule.actions {
                if budget.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |b| b.checked_sub(1)).is_err() {
                    status = "skipped";
                    done.push("stopped: too many automation actions for one change".into());
                    break;
                }
                match apply(store, notifier, &actor, rule, task_id, action, today).await {
                    Ok(what) => done.push(what),
                    Err(why) => {
                        status = "failed";
                        done.push(why);
                        break;
                    }
                }
            }
        }
        Err(why) => {
            status = "failed";
            done.push(why);
        }
    }
    record_run(store, rule, task_id, trigger_kind, status, &done.join("; ")).await;
    true
}

/// The identity a rule acts as: the Automation actor, scoped to the rule's
/// project. Fails when the project is gone.
async fn actor_for(store: &Store, rule: &RuleRecord) -> Result<AuthUser, String> {
    let pid: i64 = rule.project_id.parse().map_err(|_| "the rule's project is gone".to_string())?;
    match load_project(store, pid).await {
        Ok(Some(_)) => {}
        Ok(None) => return Err("the rule's project is gone".into()),
        Err(e) => return Err(format!("could not load the project: {e}")),
    }
    let id = system_actor_id(store).await.map_err(|e| format!("no automation identity: {e}"))?;
    Ok(AuthUser::automation(&id, &rule.project_id))
}

fn reason(e: connectrpc_axum::ConnectError) -> String {
    e.message().unwrap_or(e.code().as_str()).to_string()
}

fn update(id: &str) -> work_pb::UpdateTaskRequest {
    work_pb::UpdateTaskRequest { id: id.to_string(), ..Default::default() }
}

fn list(values: Vec<String>) -> Option<work_pb::StringList> {
    Some(work_pb::StringList { values })
}

/// HTML for a plain-text comment.
fn paragraph(text: &str) -> String {
    let escaped = text
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;");
    format!("<p>{escaped}</p>")
}

/// Who a notify action reaches right now, or why it cannot.
async fn recipients(
    store: &Store,
    rule: &RuleRecord,
    task: &TaskRecord,
    target: NotifyTarget,
    user_id: &str,
) -> Result<Vec<String>, String> {
    match target {
        NotifyTarget::Assignees => Ok(task.assignee_ids.clone()),
        NotifyTarget::Owner => match load_project(store, rule.project_id.parse().unwrap_or(0)).await {
            Ok(Some(p)) => Ok(vec![p.owner_id]),
            _ => Err("the project is gone".into()),
        },
        NotifyTarget::User => {
            if is_member(store, &rule.project_id, user_id).await.map_err(|e| e.to_string())? {
                Ok(vec![user_id.to_string()])
            } else {
                Err("the person to notify is no longer in this project".into())
            }
        }
    }
}

/// Apply one action. `Ok` describes what it did; `Err` why it could not.
async fn apply(
    store: &Store,
    notifier: Option<&Arc<Notifier>>,
    actor: &AuthUser,
    rule: &RuleRecord,
    task_id: &str,
    action: &Action,
    today: Date,
) -> Result<String, String> {
    let pid: i64 = task_id.parse().map_err(|_| "bad task id".to_string())?;
    let task = load_task(store, pid)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "the task no longer exists".to_string())?;
    let edit = |r: work_pb::UpdateTaskRequest, what: String| async move {
        update_task_core(store, notifier, actor, r).await.map(|_| what).map_err(reason)
    };
    match action {
        Action::SetStatus { status_id } => {
            let mut r = update(task_id);
            r.status_id = Some(status_id.clone());
            edit(r, "set the status".into()).await
        }
        Action::SetPriority { priority } => {
            let p = TaskPriority::parse(priority).ok_or_else(|| format!("unknown priority {priority}"))?;
            let mut r = update(task_id);
            r.priority = Some(p.to_proto());
            edit(r, format!("set priority {priority}")).await
        }
        Action::AddLabel { label_id } => {
            if task.label_ids.contains(label_id) {
                return Ok("label already there".into());
            }
            let mut labels = task.label_ids.clone();
            labels.push(label_id.clone());
            let mut r = update(task_id);
            r.label_ids = list(labels);
            edit(r, "added a label".into()).await
        }
        Action::RemoveLabel { label_id } => {
            if !task.label_ids.contains(label_id) {
                return Ok("label not there".into());
            }
            let mut r = update(task_id);
            r.label_ids = list(task.label_ids.iter().filter(|l| *l != label_id).cloned().collect());
            edit(r, "removed a label".into()).await
        }
        Action::Assign { user_id } => {
            let who = if user_id.is_empty() { task.created_by.clone() } else { user_id.clone() };
            if task.assignee_ids.contains(&who) {
                return Ok("already assigned".into());
            }
            let mut ids = task.assignee_ids.clone();
            ids.push(who);
            let mut r = update(task_id);
            r.assignee_ids = list(ids);
            // The cores refuse a non-member assignee; that is the run's reason.
            edit(r, "assigned".into()).await
        }
        Action::UnassignAll => {
            if task.assignee_ids.is_empty() {
                return Ok("nobody assigned".into());
            }
            let mut r = update(task_id);
            r.assignee_ids = list(Vec::new());
            edit(r, "unassigned everyone".into()).await
        }
        Action::MoveToModule { module_id } => {
            if &task.module_id == module_id {
                return Ok("already in that module".into());
            }
            let r = work_pb::MoveTaskRequest { id: task_id.to_string(), module_id: module_id.clone(), order: i32::MAX };
            move_task_core(store, actor, r).await.map(|_| "moved to another module".to_string()).map_err(reason)
        }
        Action::SetDueIn { days } => {
            let due = format_date(today + Duration::days(*days as i64));
            let mut r = update(task_id);
            // A start after the new due date would be refused; drop it.
            if task.start_date.as_deref().is_some_and(|s| s.get(..10).unwrap_or(s) > due.as_str()) {
                r.start_date = Some(String::new());
            }
            r.due_date = Some(due.clone());
            edit(r, format!("set due date {due}")).await
        }
        Action::Notify { target, user_id, message } => {
            let to = recipients(store, rule, &task, *target, user_id).await?;
            if let Some(n) = notifier {
                let refs = NotifRefs::task(&rule.project_id, task_id);
                for r in &to {
                    emit(store, n, r, NotificationType::Automation, &actor.id, message.clone(), refs.clone())
                        .await;
                }
            }
            Ok(format!("notified {}", to.len()))
        }
        Action::Comment { text } => {
            let r = comment_pb::CreateCommentRequest {
                task_id: task_id.to_string(),
                content: paragraph(text),
                mentioned_user_ids: Vec::new(),
            };
            create_comment_core(store, notifier, actor, r).await.map(|_| "commented".to_string()).map_err(reason)
        }
    }
}

// ── Observe ──────────────────────────────────────────────────────────────────

async fn name_in(store: &Store, sql: &str, id: &str, project_id: &str) -> Option<String> {
    let pid: i64 = id.parse().ok()?;
    sqlx::query_scalar::<_, String>(sql).bind(pid).bind(project_id).fetch_optional(store.pool()).await.ok()?
}

async fn user_name(store: &Store, id: &str) -> String {
    let Ok(pid) = id.parse::<i64>() else { return "someone".into() };
    sqlx::query_scalar::<_, String>("SELECT display_name FROM cmp_userprofile WHERE pid = $1")
        .bind(pid)
        .fetch_optional(store.pool())
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "someone".into())
}

/// What `action` would do to `task` right now — or why it would fail, under
/// the same rules a real run follows. Changes nothing.
async fn would(store: &Store, rule: &RuleRecord, task: &TaskRecord, action: &Action, today: Date) -> String {
    let p = &rule.project_id;
    let gone = |what: &str| format!("would fail: the {what} is no longer in this project");
    match action {
        Action::SetStatus { status_id } => {
            match name_in(store, "SELECT name FROM cmp_taskstatusdef WHERE pid = $1 AND project_id = $2", status_id, p).await {
                Some(n) => format!("would set status → {n}"),
                None => gone("status"),
            }
        }
        Action::SetPriority { priority } => format!("would set priority → {priority}"),
        Action::AddLabel { label_id } | Action::RemoveLabel { label_id } => {
            let verb = if matches!(action, Action::AddLabel { .. }) { "add" } else { "remove" };
            match name_in(store, "SELECT name FROM cmp_labelinfo WHERE pid = $1 AND project_id = $2", label_id, p).await {
                Some(n) => format!("would {verb} label {n}"),
                None => gone("label"),
            }
        }
        Action::Assign { user_id } => {
            let who = if user_id.is_empty() { task.created_by.clone() } else { user_id.clone() };
            match is_member(store, p, &who).await {
                Ok(true) => format!("would assign {}", user_name(store, &who).await),
                _ => gone("person to assign"),
            }
        }
        Action::UnassignAll => "would unassign everyone".into(),
        Action::MoveToModule { module_id } => {
            match name_in(
                store,
                "SELECT n.value FROM cmp_modulename n JOIN cmp_moduleprojectref r ON r.pid = n.pid \
                 WHERE n.pid = $1 AND r.project_id = $2",
                module_id,
                p,
            )
            .await
            {
                Some(n) => format!("would move to {n}"),
                None => gone("module"),
            }
        }
        Action::SetDueIn { days } => format!("would set due date {}", format_date(today + Duration::days(*days as i64))),
        Action::Notify { target, user_id, .. } => match recipients(store, rule, task, *target, user_id).await {
            Ok(to) if to.is_empty() => "would notify nobody (no assignees)".into(),
            Ok(to) => {
                let mut names = Vec::with_capacity(to.len());
                for id in &to {
                    names.push(user_name(store, id).await);
                }
                format!("would notify {}", names.join(", "))
            }
            Err(why) => format!("would fail: {why}"),
        },
        Action::Comment { .. } => "would add a comment".into(),
    }
}

/// Record what a rule in observe mode would do. Writes only the run.
async fn observe_rule(store: &Store, rule: &RuleRecord, task_id: &str, trigger_kind: &str, today: Date) -> bool {
    let Some(task) = matching_task(store, rule, task_id).await else { return false };
    let mut lines = Vec::with_capacity(rule.actions.len());
    match actor_for(store, rule).await {
        Ok(_) => {
            for a in &rule.actions {
                lines.push(would(store, rule, &task, a, today).await);
            }
        }
        Err(why) => lines.push(format!("would fail: {why}")),
    }
    record_run(store, rule, task_id, trigger_kind, "observed", &lines.join("; ")).await;
    true
}

// ── Time-based ───────────────────────────────────────────────────────────────

/// The time-based rules: overdue tasks, and tasks due within N days. Each
/// (rule, task, due date) runs once — and, separately, is observed once, so
/// a rule switched from observe to on still acts on tasks it only watched.
/// Returns how many runs (observed ones included) happened.
pub async fn run_scheduled(store: &Store, notifier: Option<&Arc<Notifier>>, today: Date) -> anyhow::Result<i32> {
    let rules = active_rules(store, None, &["overdue", "due_in"]).await?;
    let templates = template_project_ids(store).await?;
    let mut count = 0;
    for rule in &rules {
        if templates.iter().any(|p| p == &rule.project_id) {
            continue;
        }
        let (from, to) = match rule.trigger {
            Some(Trigger::Overdue) => (None, today - Duration::days(1)),
            Some(Trigger::DueIn { days }) => (Some(today), today + Duration::days(days as i64)),
            _ => continue,
        };
        let from = from.map(format_date);
        let tasks = open_tasks_due_between(store, &rule.project_id, from.as_deref(), &format_date(to)).await?;
        let kind = rule.trigger.as_ref().map_or("", Trigger::kind);
        for (pid, due) in tasks {
            let task_id = pid.to_string();
            // Conditions first, so a task that does not match yet can still
            // run once it does.
            if matching_task(store, rule, &task_id).await.is_none() {
                continue;
            }
            let key = if rule.mode == Mode::Observe { format!("observe:{due}") } else { due };
            if !claim_fired(store, rule.pid, &task_id, &key).await? {
                continue;
            }
            let ran = if rule.mode == Mode::Observe {
                observe_rule(store, rule, &task_id, kind, today).await
            } else {
                let chain = Chain {
                    depth: 1,
                    budget: Arc::new(AtomicUsize::new(MAX_ACTIONS_PER_EVENT)),
                    rule: Some(rule.pid),
                };
                CHAIN.scope(chain, run_rule(store, notifier, rule, &task_id, kind, today)).await
            };
            if ran {
                count += 1;
            }
        }
    }
    Ok(count)
}
