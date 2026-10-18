//! End-to-end automations: rule CRUD and validation, the change-triggered
//! engine (triggers, conditions, actions, chain limits) and the time-based
//! sweep, over the real Connect routers + Postgres. Skipped unless
//! `DATABASE_URL` is set.

use std::sync::Arc;

use auth::{sign_jwt, verify_jwt};
use axum::body::{to_bytes, Body};
use axum::extract::Request;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::StatusCode;
use axum::middleware::{from_fn, Next};
use axum::response::Response;
use axum::{Extension, Router};
use domain::user::{UserPassword, UserPhone, UserProfile, UserStatusComponent};
use persistence::Store;
use serde_json::{json, Value};
use tower::ServiceExt;
use transport::Notifier;

const SECRET: &str = "test-secret";
const PROJECT: &str = "/sedjiwa.tasks.project.v1.ProjectService";
const MODULE: &str = "/sedjiwa.tasks.work.v1.ModuleService";
const TASK: &str = "/sedjiwa.tasks.work.v1.TaskService";
const STATUS: &str = "/sedjiwa.tasks.work.v1.TaskStatusService";
const LABEL: &str = "/sedjiwa.tasks.label.v1.LabelService";
const COMMENT: &str = "/sedjiwa.tasks.comment.v1.CommentService";
const NOTIF: &str = "/sedjiwa.tasks.notification.v1.NotificationService";
const ACTIVITY: &str = "/sedjiwa.tasks.activity.v1.ActivityService";
const AUTO: &str = "/sedjiwa.tasks.automation.v1.AutomationService";
const DIR: &str = "/sedjiwa.tasks.auth.v1.UserDirectoryService";

fn uniq() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos().to_string()
}

async fn auth_mw(mut req: Request, next: Next) -> Response {
    if let Some(tok) = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
    {
        if let Ok(u) = verify_jwt(tok.trim(), SECRET) {
            req.extensions_mut().insert(u);
        }
    }
    next.run(req).await
}

async fn setup() -> Option<(Router, Arc<Store>)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let store = Arc::new(Store::connect(&url).await.unwrap());
    let notifier = Arc::new(Notifier::new());
    let router = transport::project_router(store.clone())
        .merge(transport::module_router(store.clone()))
        .merge(transport::task_router(store.clone()))
        .merge(transport::status_router(store.clone()))
        .merge(transport::label_router(store.clone()))
        .merge(transport::comment_router(store.clone()))
        .merge(transport::activity_router(store.clone()))
        .merge(transport::notification_router(store.clone(), notifier.clone()))
        .merge(transport::automation_router(store.clone()))
        .merge(transport::user_router(store.clone()))
        .layer(Extension(notifier))
        .layer(from_fn(auth_mw));
    Some((router, store))
}

fn token(sub: &str) -> String {
    sign_jwt(SECRET, sub, &["projects:create".to_string()], 9_999_999_999).unwrap()
}

fn admin_token(sub: &str) -> String {
    sign_jwt(SECRET, sub, &["*".to_string()], 9_999_999_999).unwrap()
}

async fn call(router: &Router, path: &str, token: Option<&str>, body: Value) -> (StatusCode, Value) {
    let mut b = Request::builder().method("POST").uri(path).header(CONTENT_TYPE, "application/json");
    if let Some(t) = token {
        b = b.header(AUTHORIZATION, format!("Bearer {t}"));
    }
    let resp = router.clone().oneshot(b.body(Body::from(body.to_string())).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

async fn ok(router: &Router, path: &str, tok: &str, body: Value) -> Value {
    let (st, v) = call(router, path, Some(tok), body).await;
    assert_eq!(st, StatusCode::OK, "{path}: {v}");
    v
}

async fn fails(router: &Router, path: &str, tok: &str, body: Value, code: &str) {
    let (st, v) = call(router, path, Some(tok), body).await;
    assert_ne!(st, StatusCode::OK, "{path} should fail: {v}");
    assert_eq!(v["code"], code, "{path}: {v}");
}

/// The ⚡ Automation system identity's user id.
async fn system_id(store: &Store) -> String {
    let pid: i64 = sqlx::query_scalar("SELECT pid FROM cmp_systemtag WHERE kind = 'automation'")
        .fetch_one(store.pool())
        .await
        .unwrap();
    pid.to_string()
}

async fn set_mode(router: &Router, tok: &str, id: &str, mode: &str) -> Value {
    ok(router, &format!("{AUTO}/SetAutomationMode"), tok, json!({ "id": id, "mode": mode })).await
}

fn s(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or_default().to_string()
}

fn num(v: &Value, key: &str) -> i64 {
    v[key].as_i64().unwrap_or(0)
}

fn arr(v: &Value, key: &str) -> Vec<Value> {
    v[key].as_array().cloned().unwrap_or_default()
}

fn strs(v: &Value, key: &str) -> Vec<String> {
    arr(v, key).iter().map(|x| x.as_str().unwrap_or_default().to_string()).collect()
}

async fn mk_user(store: &Store) -> String {
    let now = "2026-01-01T00:00:00Z".to_string();
    store
        .create((
            UserPhone { value: format!("a{}", uniq()), verified: true },
            UserPassword { hash: "x".into(), changed_at: now.clone() },
            UserProfile { display_name: "A".into(), avatar_url: String::new(), email: String::new() },
            UserStatusComponent { status: "active".into(), created_at: now, last_login_at: None },
        ))
        .await
        .unwrap()
        .to_string()
}

/// A project with members, its default statuses by category, a label pair and two modules.
struct Proj {
    id: String,
    todo: String,
    in_progress: String,
    done: String,
    l1: String,
    l2: String,
    m1: String,
    m2: String,
}

async fn proj(router: &Router, owner: &str, members: &[&str]) -> Proj {
    let to = token(owner);
    let p = ok(router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("A{}", uniq()) })).await;
    let id = s(&p, "id");
    for m in members {
        ok(router, &format!("{PROJECT}/AddProjectMember"), &to, json!({ "projectId": id, "userId": m })).await;
    }
    let st = ok(router, &format!("{STATUS}/ListTaskStatuses"), &to, json!({ "projectId": id })).await;
    let first = |cat: &str| arr(&st, "statuses").iter().find(|x| x["category"] == cat).map(|x| s(x, "id")).unwrap();
    let label = |n: &str| {
        let (router, to, id) = (router.clone(), to.clone(), id.clone());
        let n = n.to_string();
        async move { s(&ok(&router, &format!("{LABEL}/CreateLabel"), &to, json!({ "projectId": id, "name": n, "color": "#123456" })).await, "id") }
    };
    let module = |n: &str| {
        let (router, to, id) = (router.clone(), to.clone(), id.clone());
        let n = n.to_string();
        async move { s(&ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": id, "name": n })).await, "id") }
    };
    Proj {
        todo: first("TODO"),
        in_progress: first("IN_PROGRESS"),
        done: first("DONE"),
        l1: label("one").await,
        l2: label("two").await,
        m1: module("M1").await,
        m2: module("M2").await,
        id,
    }
}

async fn rule(router: &Router, tok: &str, project: &str, name: &str, trigger: Value, actions: Value, conditions: Value) -> String {
    s(&ok(router, &format!("{AUTO}/CreateAutomation"), tok, json!({
        "projectId": project, "name": name, "trigger": trigger, "actions": actions,
        "conditions": conditions, "mode": "AUTOMATION_MODE_ON"
    })).await, "id")
}

async fn task(router: &Router, tok: &str, module: &str, body: Value) -> Value {
    let mut b = json!({ "moduleId": module, "title": "T" });
    b.as_object_mut().unwrap().extend(body.as_object().unwrap().clone());
    ok(router, &format!("{TASK}/CreateTask"), tok, b).await
}

async fn get(router: &Router, tok: &str, id: &str) -> Value {
    ok(router, &format!("{TASK}/GetTask"), tok, json!({ "id": id })).await
}

async fn update(router: &Router, tok: &str, body: Value) -> Value {
    ok(router, &format!("{TASK}/UpdateTask"), tok, body).await
}

/// Runs of one project, newest first.
async fn runs(router: &Router, tok: &str, project: &str) -> Vec<Value> {
    arr(&ok(router, &format!("{AUTO}/ListAutomationRuns"), tok, json!({ "projectId": project, "limit": 200 })).await, "runs")
}

fn runs_of<'a>(all: &'a [Value], rule: &str) -> Vec<&'a Value> {
    all.iter().filter(|r| r["automationId"] == rule).collect()
}

async fn comments(router: &Router, tok: &str, task: &str) -> Vec<Value> {
    arr(&ok(router, &format!("{COMMENT}/ListComments"), tok, json!({ "taskId": task })).await, "comments")
}

async fn notifications(router: &Router, tok: &str) -> Vec<Value> {
    arr(&ok(router, &format!("{NOTIF}/ListNotifications"), tok, json!({ "pageSize": 100 })).await, "notifications")
}

// ── CRUD, permissions, validation ────────────────────────────────────────────

#[tokio::test]
async fn automation_rpcs_require_a_token() {
    let Some((router, _store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    for (m, body) in [
        ("ListAutomations", json!({ "projectId": "1" })),
        ("CreateAutomation", json!({ "projectId": "1", "name": "x" })),
        ("UpdateAutomation", json!({ "id": "1", "name": "x" })),
        ("DeleteAutomation", json!({ "id": "1" })),
        ("SetAutomationMode", json!({ "id": "1", "mode": "AUTOMATION_MODE_ON" })),
        ("ListAutomationRuns", json!({ "projectId": "1" })),
        ("RunScheduledAutomations", json!({})),
    ] {
        let (st, v) = call(&router, &format!("{AUTO}/{m}"), None, body).await;
        assert_ne!(st, StatusCode::OK, "{m} without a token must fail");
        assert_eq!(v["code"], "unauthenticated", "{m} without a token: {v}");
    }
}

#[tokio::test]
async fn rules_are_managed_by_owner_or_admin_and_read_by_members() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, member, outsider, admin) = (mk_user(&store).await, mk_user(&store).await, mk_user(&store).await, mk_user(&store).await);
    let (to, tm, tx, ta) = (token(&owner), token(&member), token(&outsider), admin_token(&admin));
    let p = proj(&router, &owner, &[&member]).await;
    let body = json!({
        "projectId": p.id, "name": "  Label new work  ", "trigger": { "taskCreated": {} },
        "actions": [{ "addLabelId": p.l1 }], "mode": "AUTOMATION_MODE_ON"
    });
    let create = format!("{AUTO}/CreateAutomation");
    fails(&router, &create, &tm, body.clone(), "permission_denied").await;
    fails(&router, &create, &tx, body.clone(), "permission_denied").await;

    let r = ok(&router, &create, &to, body.clone()).await;
    let id = s(&r, "id");
    assert_eq!(r["name"], "Label new work", "the name is trimmed");
    assert_eq!(r["mode"], "AUTOMATION_MODE_ON");
    assert_eq!(r["updatedBy"], owner.as_str(), "the creator is the first writer");
    assert_eq!(r["createdBy"], owner.as_str());
    assert!(r["trigger"]["taskCreated"].is_object(), "the trigger round-trips: {r}");
    assert_eq!(arr(&r, "actions")[0]["addLabelId"], p.l1.as_str());
    fails(&router, &create, &to, json!({
        "projectId": p.id, "name": "no mode", "trigger": { "taskCreated": {} }, "actions": [{ "addLabelId": p.l2 }]
    }), "invalid_argument").await;
    let disabled = ok(&router, &create, &to, json!({
        "projectId": p.id, "name": "off", "trigger": { "taskCreated": {} }, "actions": [{ "addLabelId": p.l2 }],
        "mode": "AUTOMATION_MODE_OFF"
    })).await;
    assert_eq!(disabled["mode"], "AUTOMATION_MODE_OFF");

    // Members read; outsiders do not.
    let list = format!("{AUTO}/ListAutomations");
    let l = ok(&router, &list, &tm, json!({ "projectId": p.id })).await;
    assert_eq!(arr(&l, "automations").len(), 2, "members list the rules");
    fails(&router, &list, &tx, json!({ "projectId": p.id }), "permission_denied").await;
    ok(&router, &format!("{AUTO}/ListAutomationRuns"), &tm, json!({ "projectId": p.id })).await;
    fails(&router, &format!("{AUTO}/ListAutomationRuns"), &tx, json!({ "projectId": p.id }), "permission_denied").await;
    fails(&router, &format!("{AUTO}/ListAutomationRuns"), &tm, json!({ "projectId": p.id, "limit": -1 }), "invalid_argument").await;

    // Update / enable / delete: owner or admin.
    let upd = format!("{AUTO}/UpdateAutomation");
    let mut changed = body.clone();
    changed["id"] = json!(id);
    changed["name"] = json!("Renamed");
    fails(&router, &upd, &tm, changed.clone(), "permission_denied").await;
    let r = ok(&router, &upd, &to, changed.clone()).await;
    assert_eq!(r["name"], "Renamed");
    assert_eq!(r["createdBy"], owner.as_str(), "an edit keeps the author");
    assert_eq!(r["updatedBy"], owner.as_str());
    let r = ok(&router, &upd, &ta, { let mut c = changed.clone(); c["name"] = json!("By admin"); c }).await;
    assert_eq!(r["name"], "By admin", "a non-member admin can edit");
    assert_eq!(r["updatedBy"], admin.as_str(), "updated_by follows the last writer");
    assert_eq!(r["createdBy"], owner.as_str());
    // The project in an update body is ignored: a rule cannot be moved.
    let other = proj(&router, &member, &[]).await;
    let mut moved = changed.clone();
    moved["projectId"] = json!(other.id);
    let r = ok(&router, &upd, &to, moved).await;
    assert_eq!(r["projectId"], p.id.as_str(), "a rule stays in its project");
    fails(&router, &upd, &token(&member), { let mut c = changed.clone(); c["id"] = json!(id); c["projectId"] = json!(other.id); c }, "permission_denied").await;

    let en = format!("{AUTO}/SetAutomationMode");
    fails(&router, &en, &tm, json!({ "id": id, "mode": "AUTOMATION_MODE_OFF" }), "permission_denied").await;
    fails(&router, &en, &to, json!({ "id": id, "mode": "AUTOMATION_MODE_UNSPECIFIED" }), "invalid_argument").await;
    fails(&router, &en, &to, json!({ "id": id }), "invalid_argument").await;
    let r = ok(&router, &en, &to, json!({ "id": id, "mode": "AUTOMATION_MODE_OBSERVE" })).await;
    assert_eq!(r["mode"], "AUTOMATION_MODE_OBSERVE");
    assert_eq!(r["updatedBy"], owner.as_str(), "a mode change sets updated_by");
    let r = ok(&router, &en, &to, json!({ "id": id, "mode": "AUTOMATION_MODE_OFF" })).await;
    assert_eq!(r["mode"], "AUTOMATION_MODE_OFF");
    let l = ok(&router, &list, &tm, json!({ "projectId": p.id })).await;
    assert!(arr(&l, "automations").iter().all(|a| a["mode"] == "AUTOMATION_MODE_OFF"), "a follow-up read shows both off");

    let del = format!("{AUTO}/DeleteAutomation");
    fails(&router, &del, &tm, json!({ "id": id }), "permission_denied").await;
    ok(&router, &del, &ta, json!({ "id": id })).await;
    fails(&router, &del, &to, json!({ "id": id }), "not_found").await;
    fails(&router, &upd, &to, changed, "not_found").await;
    fails(&router, &en, &to, json!({ "id": "abc", "mode": "AUTOMATION_MODE_ON" }), "not_found").await;

    // The sweep is admin only.
    fails(&router, &format!("{AUTO}/RunScheduledAutomations"), &to, json!({}), "permission_denied").await;
    fails(&router, &format!("{AUTO}/RunScheduledAutomations"), &ta, json!({ "today": "2026-02-30" }), "invalid_argument").await;
}

#[tokio::test]
async fn rules_are_validated_against_their_project() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, member, outsider) = (mk_user(&store).await, mk_user(&store).await, mk_user(&store).await);
    let to = token(&owner);
    let p = proj(&router, &owner, &[&member]).await;
    let q = proj(&router, &owner, &[]).await;
    let create = format!("{AUTO}/CreateAutomation");
    let base = |trigger: Value, actions: Value| json!({ "projectId": p.id, "name": "r", "trigger": trigger, "actions": actions, "mode": "AUTOMATION_MODE_ON" });
    let created = json!({ "taskCreated": {} });
    let note = |m: &str| json!([{ "comment": m }]);

    let cases: Vec<(Value, &str)> = vec![
        ({ let mut b = base(created.clone(), note("x")); b["name"] = json!("   "); b }, "blank name"),
        ({ let mut b = base(created.clone(), note("x")); b["name"] = json!("n".repeat(81)); b }, "81-char name"),
        (json!({ "projectId": p.id, "name": "r", "actions": note("x"), "mode": "AUTOMATION_MODE_ON" }), "no trigger"),
        (base(json!({}), note("x")), "empty trigger"),
        (base(created.clone(), json!([])), "no actions"),
        (base(created.clone(), json!([{ "comment": "1" }, { "comment": "2" }, { "comment": "3" }, { "comment": "4" }, { "comment": "5" }, { "comment": "6" }])), "6 actions"),
        (base(created.clone(), json!([{}])), "an empty action"),
        (base(json!({ "dueIn": { "days": 0 } }), note("x")), "due in 0"),
        (base(json!({ "dueIn": { "days": 31 } }), note("x")), "due in 31"),
        (base(created.clone(), json!([{ "setDueInDays": -1 }])), "set due -1"),
        (base(created.clone(), json!([{ "setDueInDays": 366 }])), "set due 366"),
        (base(created.clone(), note("   ")), "blank comment"),
        (base(created.clone(), note(&"c".repeat(501))), "501-char comment"),
        (base(created.clone(), json!([{ "notify": { "target": "NOTIFY_TARGET_OWNER", "message": "" } }])), "blank notify"),
        (base(created.clone(), json!([{ "notify": { "target": "NOTIFY_TARGET_USER", "message": "m" } }])), "notify user without user"),
        (base(created.clone(), json!([{ "notify": { "target": "NOTIFY_TARGET_UNSPECIFIED", "message": "m" } }])), "notify nobody"),
        (base(created.clone(), json!([{ "notify": { "target": "NOTIFY_TARGET_USER", "userId": outsider, "message": "m" } }])), "notify a non-member"),
        (base(created.clone(), json!([{ "assignUserId": outsider }])), "assign a non-member"),
        (base(created.clone(), json!([{ "setStatusId": q.done }])), "a status of another project"),
        (base(json!({ "statusChanged": { "toStatusId": q.done } }), note("x")), "a trigger status of another project"),
        (base(created.clone(), json!([{ "addLabelId": q.l1 }])), "a label of another project"),
        (base(created.clone(), json!([{ "removeLabelId": "999999999999" }])), "an unknown label"),
        (base(created.clone(), json!([{ "moveToModuleId": q.m1 }])), "a module of another project"),
        (base(created.clone(), json!([{ "setPriority": "critical" }])), "an unknown priority"),
        ({ let mut b = base(created.clone(), note("x")); b["conditions"] = json!({ "priorities": ["critical"] }); b }, "an unknown priority condition"),
        ({ let mut b = base(created.clone(), note("x")); b["conditions"] = json!({ "labelIds": [q.l1] }); b }, "a label condition of another project"),
        ({ let mut b = base(created.clone(), note("x")); b["conditions"] = json!({ "moduleIds": [q.m1] }); b }, "a module condition of another project"),
    ];
    for (body, why) in cases {
        let (st, v) = call(&router, &create, Some(&to), body).await;
        assert_ne!(st, StatusCode::OK, "{why} should be refused: {v}");
        assert_eq!(v["code"], "invalid_argument", "{why}: {v}");
    }
    // The bounds themselves are fine.
    ok(&router, &create, &to, base(json!({ "dueIn": { "days": 30 } }), json!([{ "setDueInDays": 365 }]))).await;
    ok(&router, &create, &to, base(json!({ "dueIn": { "days": 1 } }), json!([{ "setDueInDays": 0 }]))).await;
    ok(&router, &create, &to, base(created.clone(), note(&"é".repeat(500)))).await;
    ok(&router, &create, &to, base(created.clone(), json!([{ "assignUserId": "" }, { "assignUserId": member }, { "unassignAll": {} },
        { "notify": { "target": "NOTIFY_TARGET_USER", "userId": member, "message": "m" } }, { "setPriority": "urgent" }]))).await;
    let l = ok(&router, &format!("{AUTO}/ListAutomations"), &to, json!({ "projectId": p.id })).await;
    assert_eq!(arr(&l, "automations").len(), 4, "only the valid rules were saved");
    fails(&router, &create, &to, json!({ "projectId": "999999999999", "name": "r", "trigger": created, "actions": note("x"), "mode": "AUTOMATION_MODE_ON" }), "permission_denied").await;
}

// ── The engine ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn each_trigger_fires_on_its_change() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, member) = (mk_user(&store).await, mk_user(&store).await);
    let (to, tm) = (token(&owner), token(&member));
    let p = proj(&router, &owner, &[&member]).await;
    let created = rule(&router, &to, &p.id, "on create", json!({ "taskCreated": {} }), json!([{ "addLabelId": p.l1 }]), json!({})).await;
    let assigned = rule(&router, &to, &p.id, "on assign", json!({ "assigneeAdded": {} }), json!([{ "comment": "welcome <b>aboard</b> & go" }]), json!({})).await;
    let to_done = rule(&router, &to, &p.id, "on done", json!({ "statusChanged": { "toStatusId": p.done } }), json!([{ "setPriority": "high" }]), json!({})).await;
    let from_todo = rule(&router, &to, &p.id, "leaving todo", json!({ "statusChanged": { "fromStatusId": p.todo, "toStatusId": p.in_progress } }), json!([{ "addLabelId": p.l2 }]), json!({})).await;
    let parent_rule = rule(&router, &to, &p.id, "all subtasks", json!({ "subtasksDone": {} }), json!([{ "comment": "subtasks finished" }]), json!({})).await;

    // task_created, by a member: the reply already shows the rule's change.
    let t = task(&router, &tm, &p.m1, json!({ "title": "Fresh" })).await;
    let tid = s(&t, "id");
    assert_eq!(strs(&t, "labelIds"), vec![p.l1.clone()], "the create reply reflects the automation");
    let all = runs(&router, &tm, &p.id).await;
    assert_eq!(runs_of(&all, &created).len(), 1);
    assert_eq!(runs_of(&all, &created)[0]["status"], "RUN_STATUS_OK");
    assert_eq!(runs_of(&all, &created)[0]["trigger"], "task_created");
    assert_eq!(runs_of(&all, &created)[0]["taskId"], tid.as_str());
    assert!(runs_of(&all, &assigned).is_empty(), "no assignee, no assignee_added");

    // assignee_added: only for someone new.
    update(&router, &tm, json!({ "id": tid, "assigneeIds": { "values": [member] } })).await;
    let c = comments(&router, &tm, &tid).await;
    assert_eq!(c.len(), 1, "the assign rule commented");
    assert_eq!(c[0]["content"], "<p>welcome &lt;b&gt;aboard&lt;/b&gt; &amp; go</p>", "comment text is escaped and wrapped");
    assert_eq!(c[0]["authorId"], system_id(&store).await.as_str(), "it is written as the Automation identity: {}", c[0]);
    assert_eq!(c[0]["automationId"], assigned.as_str(), "and carries the rule");
    assert_eq!(c[0]["automationName"], "on assign");
    update(&router, &tm, json!({ "id": tid, "assigneeIds": { "values": [member] }, "title": "Fresh again" })).await;
    assert_eq!(runs_of(&runs(&router, &tm, &p.id).await, &assigned).len(), 1, "re-saving the same assignees adds nobody");
    // Created with an assignee: both task_created and assignee_added.
    let t2 = task(&router, &tm, &p.m1, json!({ "title": "Born assigned", "assigneeIds": [owner] })).await;
    let all = runs(&router, &tm, &p.id).await;
    assert!(runs_of(&all, &assigned).iter().any(|r| r["taskId"] == t2["id"]), "assignee_added fires on create with assignees");

    // status_changed: from/to are exact.
    update(&router, &tm, json!({ "id": tid, "statusId": p.in_progress })).await;
    let all = runs(&router, &tm, &p.id).await;
    assert_eq!(runs_of(&all, &from_todo).len(), 1, "todo → in progress matches from+to");
    assert!(runs_of(&all, &to_done).is_empty(), "not done yet");
    update(&router, &tm, json!({ "id": tid, "statusId": p.done })).await;
    let all = runs(&router, &tm, &p.id).await;
    assert_eq!(runs_of(&all, &to_done).len(), 1, "any → done matches a to-only trigger");
    assert_eq!(runs_of(&all, &from_todo).len(), 1, "in progress → done does not match from=todo");
    assert_eq!(get(&router, &tm, &tid).await["priority"], "HIGH");
    let t3 = task(&router, &tm, &p.m1, json!({ "title": "Straight", "status": "DONE" })).await;
    assert!(runs_of(&runs(&router, &tm, &p.id).await, &to_done).iter().all(|r| r["taskId"] != t3["id"]),
        "creating a task already done is not a status change");

    // subtasks_done: once the last open subtask is done; cancelled ones don't block.
    let parent = s(&task(&router, &tm, &p.m1, json!({ "title": "Parent" })).await, "id");
    let a = s(&task(&router, &tm, &p.m1, json!({ "title": "a", "parentId": parent })).await, "id");
    let b = s(&task(&router, &tm, &p.m1, json!({ "title": "b", "parentId": parent })).await, "id");
    task(&router, &tm, &p.m1, json!({ "title": "c", "parentId": parent, "status": "CANCELLED" })).await;
    update(&router, &tm, json!({ "id": a, "statusId": p.done })).await;
    assert!(runs_of(&runs(&router, &tm, &p.id).await, &parent_rule).is_empty(), "one subtask still open");
    update(&router, &tm, json!({ "id": b, "statusId": p.done })).await;
    let pr = runs_of(&runs(&router, &tm, &p.id).await, &parent_rule).into_iter().cloned().collect::<Vec<_>>();
    assert_eq!(pr.len(), 1, "the last subtask done fires once");
    assert_eq!(pr[0]["taskId"], parent.as_str(), "on the parent");
    assert_eq!(comments(&router, &tm, &parent).await.len(), 1);
    // A parent whose only subtasks are cancelled never fires.
    let lonely = s(&task(&router, &tm, &p.m1, json!({ "title": "Lonely" })).await, "id");
    let x = s(&task(&router, &tm, &p.m1, json!({ "title": "x", "parentId": lonely })).await, "id");
    update(&router, &tm, json!({ "id": x, "status": "CANCELLED" })).await;
    assert!(runs_of(&runs(&router, &tm, &p.id).await, &parent_rule).iter().all(|r| r["taskId"] != lonely.as_str()));

    // Disabled rules never run.
    let before = runs_of(&runs(&router, &tm, &p.id).await, &created).len();
    assert_eq!(before, 9, "every create so far ran it, subtasks included");
    set_mode(&router, &to, &created, "AUTOMATION_MODE_OFF").await;
    let t4 = task(&router, &tm, &p.m1, json!({ "title": "After pause" })).await;
    assert!(strs(&t4, "labelIds").is_empty(), "a paused rule does nothing");
    assert_eq!(runs_of(&runs(&router, &tm, &p.id).await, &created).len(), before, "and records no run");
    // Bulk edits go through the same path.
    let t5 = s(&task(&router, &tm, &p.m1, json!({ "title": "Bulk" })).await, "id");
    ok(&router, &format!("{TASK}/BulkUpdateTasks"), &tm, json!({ "taskIds": [t5], "statusId": p.done })).await;
    assert!(runs_of(&runs(&router, &tm, &p.id).await, &to_done).iter().any(|r| r["taskId"] == t5.as_str()), "a bulk status change fires too");
}

#[tokio::test]
async fn conditions_and_across_lists_or_within() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);
    let p = proj(&router, &owner, &[]).await;
    let r = rule(&router, &to, &p.id, "picky", json!({ "taskCreated": {} }), json!([{ "comment": "matched" }]),
        json!({ "priorities": ["high", "urgent"], "labelIds": [p.l1, p.l2], "moduleIds": [p.m1] })).await;
    let cases = [
        (json!({ "priority": "HIGH", "labelIds": [p.l1], "moduleId": p.m1 }), true, "all three match"),
        (json!({ "priority": "URGENT", "labelIds": [p.l2], "moduleId": p.m1 }), true, "OR within each list"),
        (json!({ "priority": "LOW", "labelIds": [p.l1], "moduleId": p.m1 }), false, "wrong priority"),
        (json!({ "priority": "HIGH", "moduleId": p.m1 }), false, "no label"),
        (json!({ "priority": "HIGH", "labelIds": [p.l1], "moduleId": p.m2 }), false, "wrong module"),
    ];
    for (body, want, why) in cases {
        let t = task(&router, &to, body["moduleId"].as_str().unwrap(), body.clone()).await;
        let ran = runs_of(&runs(&router, &to, &p.id).await, &r).iter().any(|x| x["taskId"] == t["id"]);
        assert_eq!(ran, want, "{why}");
        assert_eq!(comments(&router, &to, &s(&t, "id")).await.len(), usize::from(want), "{why}: no run, no action");
    }
}

#[tokio::test]
async fn actions_change_the_task_as_the_rules_author() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, member, watcher) = (mk_user(&store).await, mk_user(&store).await, mk_user(&store).await);
    let (to, tm) = (token(&owner), token(&member));
    let p = proj(&router, &owner, &[&member, &watcher]).await;
    let name = "Triage";
    let edits = rule(&router, &to, &p.id, name, json!({ "statusChanged": { "toStatusId": p.in_progress } }), json!([
        { "setPriority": "urgent" }, { "addLabelId": p.l1 }, { "removeLabelId": p.l2 },
        { "assignUserId": "" }, { "moveToModuleId": p.m2 }
    ]), json!({})).await;
    let tells = rule(&router, &to, &p.id, "Heads up", json!({ "statusChanged": { "toStatusId": p.in_progress } }), json!([
        { "setDueInDays": 3 },
        { "notify": { "target": "NOTIFY_TARGET_ASSIGNEES", "message": "started" } },
        { "notify": { "target": "NOTIFY_TARGET_OWNER", "message": "fyi owner" } },
        { "notify": { "target": "NOTIFY_TARGET_USER", "userId": watcher, "message": "fyi watcher" } },
        { "removeLabelId": p.l2 }
    ]), json!({})).await;

    // Member creates (so the creator is the member) with a start far ahead and label two.
    let t = task(&router, &tm, &p.m1, json!({ "title": "Work", "labelIds": [p.l2], "startDate": "2099-01-01" })).await;
    let tid = s(&t, "id");
    let reply = update(&router, &tm, json!({ "id": tid, "statusId": p.in_progress })).await;
    assert_eq!(reply["priority"], "URGENT", "the update reply reflects the automation: {reply}");

    let got = get(&router, &tm, &tid).await;
    assert_eq!(got["priority"], "URGENT");
    assert_eq!(strs(&got, "labelIds"), vec![p.l1.clone()], "label one added, label two removed");
    assert_eq!(strs(&got, "assigneeIds"), vec![member.clone()], "an empty assign means the task's creator");
    assert_eq!(got["moduleId"], p.m2.as_str(), "moved to the other module");
    let due = (time::OffsetDateTime::now_utc().date() + time::Duration::days(3)).to_string();
    assert_eq!(got["dueDate"], due.as_str(), "due = today (UTC) + 3");
    assert!(got["startDate"].is_null(), "a start after the new due date is cleared: {got}");

    let all = runs(&router, &tm, &p.id).await;
    let e = runs_of(&all, &edits);
    assert_eq!(e.len(), 1);
    assert_eq!(e[0]["status"], "RUN_STATUS_OK", "{}", e[0]);
    let h = runs_of(&all, &tells);
    assert_eq!(h[0]["status"], "RUN_STATUS_OK", "{}", h[0]);
    assert!(s(h[0], "detail").contains("label not there"), "removing an absent label is a no-op: {}", h[0]);

    // Activity: the person's change as the person; the rule's edits as Automation, tagged.
    let sys = system_id(&store).await;
    let act = ok(&router, &format!("{ACTIVITY}/ListEntityActivity"), &to, json!({ "entityType": "TASK", "entityId": tid })).await;
    let rows = arr(&act, "activities");
    assert!(rows.iter().any(|a| s(a, "actorId") == member && a["automationId"].is_null()), "the member's own change is untagged: {act}");
    let auto_rows: Vec<&Value> = rows.iter().filter(|a| s(a, "actorId") == sys).collect();
    assert!(!auto_rows.is_empty(), "the rule's edits are the Automation identity's activity: {act}");
    assert!(auto_rows.iter().all(|a| a["automationId"] == edits.as_str() || a["automationId"] == tells.as_str()), "tagged with the rule that made them: {act}");
    assert!(auto_rows.iter().any(|a| a["automationName"] == name));
    assert!(rows.iter().all(|a| s(a, "actorId") != owner), "nothing is attributed to the rule's author: {act}");

    // Notifications: type AUTOMATION, no actor, "<rule>: <message>"; the author hears too.
    let auto = |list: Vec<Value>| list.into_iter().filter(|n| n["type"] == "AUTOMATION").collect::<Vec<_>>();
    let mine = auto(notifications(&router, &tm).await);
    assert!(mine.iter().any(|n| n["message"] == "started"), "assignees notified, with the plain message: {mine:?}");
    assert!(mine.iter().all(|n| !s(n, "message").starts_with("Heads up:")), "the rule name is not repeated in the message: {mine:?}");
    assert!(mine.iter().all(|n| s(n, "actorId") == sys), "the actor is the Automation identity: {mine:?}");
    assert!(mine.iter().all(|n| n["automationId"] == tells.as_str() && n["automationName"] == "Heads up"), "notifications carry the rule");
    assert!(mine.iter().all(|n| n["taskId"] == tid.as_str() && n["projectId"] == p.id.as_str()), "it links to the task");
    let owners = auto(notifications(&router, &to).await);
    assert!(owners.iter().any(|n| n["message"] == "fyi owner" && n["automationName"] == "Heads up"), "the owner — the rule's own author — is notified: {owners:?}");
    let watchers = auto(notifications(&router, &token(&watcher)).await);
    assert_eq!(watchers.len(), 1);
    assert_eq!(watchers[0]["message"], "fyi watcher");
    assert_eq!(watchers[0]["automationName"], "Heads up", "the name travels in the tag");
}

#[tokio::test]
async fn a_failing_action_stops_the_rest_of_the_rule() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);
    let p = proj(&router, &owner, &[]).await;
    let r = rule(&router, &to, &p.id, "fragile", json!({ "taskCreated": {} }),
        json!([{ "comment": "first" }, { "moveToModuleId": p.m2 }, { "comment": "never" }]), json!({})).await;
    ok(&router, &format!("{MODULE}/DeleteModule"), &to, json!({ "id": p.m2 })).await;
    let t = task(&router, &to, &p.m1, json!({ "title": "Doomed rule" })).await;
    let run = runs_of(&runs(&router, &to, &p.id).await, &r).into_iter().next().cloned().unwrap();
    assert_eq!(run["status"], "RUN_STATUS_FAILED", "{run}");
    assert!(!s(&run, "detail").is_empty(), "the run says why");
    let c = comments(&router, &to, &s(&t, "id")).await;
    assert_eq!(c.len(), 1, "the action before the failure ran, the one after did not");
    assert_eq!(c[0]["content"], "<p>first</p>");
    assert_eq!(get(&router, &to, &s(&t, "id")).await["title"], "Doomed rule", "the person's change still went through");
}

#[tokio::test]
async fn a_rule_keeps_running_when_its_author_is_suspended() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, admin) = (mk_user(&store).await, mk_user(&store).await);
    let to = token(&owner);
    let p = proj(&router, &owner, &[]).await;
    // An admin (not a member) writes the rule, then is suspended.
    let r = rule(&router, &admin_token(&admin), &p.id, "by admin", json!({ "taskCreated": {} }), json!([{ "comment": "hi" }]), json!({})).await;
    store
        .attach(admin.parse().unwrap(), UserStatusComponent { status: "suspended".into(), created_at: "2026-01-01T00:00:00Z".into(), last_login_at: None })
        .await
        .unwrap();
    let t = task(&router, &to, &p.m1, json!({ "title": "x" })).await;
    let run = runs_of(&runs(&router, &to, &p.id).await, &r).into_iter().next().cloned().unwrap();
    assert_eq!(run["status"], "RUN_STATUS_OK", "rules run as the project, not the author: {run}");
    let c = comments(&router, &to, &s(&t, "id")).await;
    assert_eq!(c.len(), 1);
    assert_eq!(c[0]["authorId"], system_id(&store).await.as_str());
}

#[tokio::test]
async fn a_rule_keeps_running_after_its_author_leaves_and_follows_the_owner() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (a, b) = (mk_user(&store).await, mk_user(&store).await);
    let (ta, tb) = (token(&a), token(&b));
    let p = proj(&router, &a, &[&b]).await;
    let r = rule(&router, &ta, &p.id, "A's notify", json!({ "taskCreated": {} }),
        json!([{ "notify": { "target": "NOTIFY_TARGET_ASSIGNEES", "message": "ping" } },
               { "notify": { "target": "NOTIFY_TARGET_OWNER", "message": "owner ping" } }]), json!({})).await;
    // A hands the project to B and leaves it.
    ok(&router, &format!("{PROJECT}/TransferProjectOwnership"), &ta, json!({ "id": p.id, "newOwnerId": b })).await;
    ok(&router, &format!("{PROJECT}/LeaveProject"), &ta, json!({ "projectId": p.id })).await;
    task(&router, &tb, &p.m1, json!({ "title": "after A left", "assigneeIds": [b] })).await;
    let run = runs_of(&runs(&router, &tb, &p.id).await, &r).into_iter().next().cloned().unwrap();
    assert_eq!(run["status"], "RUN_STATUS_OK", "the rule runs as the project after its author left: {run}");
    let got: Vec<Value> = notifications(&router, &tb).await.into_iter().filter(|n| n["type"] == "AUTOMATION").collect();
    assert!(got.iter().any(|n| n["message"] == "ping"), "the assignee is notified: {got:?}");
    assert!(got.iter().any(|n| n["message"] == "owner ping"), "OWNER resolves to the new owner B: {got:?}");
    let sys = system_id(&store).await;
    assert!(got.iter().all(|n| s(n, "actorId") == sys), "sent as Automation, not as A");
    let to_a = notifications(&router, &ta).await.into_iter().filter(|n| n["message"] == "owner ping").count();
    assert_eq!(to_a, 0, "the old owner no longer gets OWNER notifications");
    // The rule card says who made it, and the author is gone from the project.
    let l = ok(&router, &format!("{AUTO}/ListAutomations"), &tb, json!({ "projectId": p.id })).await;
    assert_eq!(arr(&l, "automations")[0]["createdBy"], a.as_str());
}

#[tokio::test]
async fn chains_go_one_level_deep_and_stop() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);
    let p = proj(&router, &owner, &[]).await;
    // Ping-pong: A sends In Progress back to To Do, B sends To Do back to In Progress.
    let a = rule(&router, &to, &p.id, "A", json!({ "statusChanged": { "toStatusId": p.in_progress } }), json!([{ "setStatusId": p.todo }]), json!({})).await;
    let b = rule(&router, &to, &p.id, "B", json!({ "statusChanged": { "toStatusId": p.todo } }), json!([{ "setStatusId": p.in_progress }]), json!({})).await;
    let t = s(&task(&router, &to, &p.m1, json!({ "title": "Ping" })).await, "id");
    update(&router, &to, json!({ "id": t, "statusId": p.in_progress })).await;
    let all = runs(&router, &to, &p.id).await;
    assert_eq!(runs_of(&all, &a).len(), 1, "A runs once");
    assert_eq!(runs_of(&all, &b).len(), 1, "B runs once (one level of chaining) and then it stops");
    assert_eq!(get(&router, &to, &t).await["statusId"], p.in_progress.as_str(), "B's change was the last");

    // A chain only continues through status changes: an automation's assignment triggers nothing.
    let q = proj(&router, &owner, &[]).await;
    let assigns = rule(&router, &to, &q.id, "assigns", json!({ "taskCreated": {} }), json!([{ "assignUserId": "" }, { "setStatusId": q.in_progress }]), json!({})).await;
    let on_assign = rule(&router, &to, &q.id, "on assign", json!({ "assigneeAdded": {} }), json!([{ "comment": "assigned" }]), json!({})).await;
    let on_status = rule(&router, &to, &q.id, "on status", json!({ "statusChanged": { "toStatusId": q.in_progress } }), json!([{ "comment": "started" }]), json!({})).await;
    let t = s(&task(&router, &to, &q.m1, json!({ "title": "Chain" })).await, "id");
    let all = runs(&router, &to, &q.id).await;
    assert_eq!(runs_of(&all, &assigns).len(), 1);
    assert!(runs_of(&all, &on_assign).is_empty(), "assignee_added from an automation does not chain");
    assert_eq!(runs_of(&all, &on_status).len(), 1, "status_changed from an automation chains one level");
    let texts: Vec<String> = comments(&router, &to, &t).await.iter().map(|c| s(c, "content")).collect();
    assert_eq!(texts, vec!["<p>started</p>".to_string()]);
}

#[tokio::test]
async fn one_change_runs_at_most_ten_actions() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);
    let p = proj(&router, &owner, &[]).await;
    let five = json!([{ "comment": "1" }, { "comment": "2" }, { "comment": "3" }, { "comment": "4" }, { "comment": "5" }]);
    let r1 = rule(&router, &to, &p.id, "r1", json!({ "taskCreated": {} }), five.clone(), json!({})).await;
    let r2 = rule(&router, &to, &p.id, "r2", json!({ "taskCreated": {} }), five.clone(), json!({})).await;
    let r3 = rule(&router, &to, &p.id, "r3", json!({ "taskCreated": {} }), five, json!({})).await;
    let t = s(&task(&router, &to, &p.m1, json!({ "title": "Busy" })).await, "id");
    let all = runs(&router, &to, &p.id).await;
    assert_eq!(runs_of(&all, &r1)[0]["status"], "RUN_STATUS_OK");
    assert_eq!(runs_of(&all, &r2)[0]["status"], "RUN_STATUS_OK");
    let third = runs_of(&all, &r3);
    assert_eq!(third.len(), 1);
    assert_eq!(third[0]["status"], "RUN_STATUS_SKIPPED", "the budget ran out: {}", third[0]);
    assert_eq!(comments(&router, &to, &t).await.len(), 10, "exactly ten actions ran");
    // The budget is per change: the next task gets its own ten.
    let t2 = s(&task(&router, &to, &p.m1, json!({ "title": "Busy too" })).await, "id");
    assert_eq!(comments(&router, &to, &t2).await.len(), 10);
}

#[tokio::test]
async fn time_based_rules_fire_once_per_due_date() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, admin) = (mk_user(&store).await, mk_user(&store).await);
    let (to, ta) = (token(&owner), admin_token(&admin));
    let p = proj(&router, &owner, &[]).await;
    // A far-future "today" keeps other tests' tasks (due 2026–2099) apart from ours.
    let today = "2031-06-10";
    let overdue = rule(&router, &to, &p.id, "late", json!({ "overdue": {} }), json!([{ "addLabelId": p.l1 }]), json!({})).await;
    let soon = rule(&router, &to, &p.id, "soon", json!({ "dueIn": { "days": 3 } }), json!([{ "comment": "due soon" }]), json!({})).await;
    let picky = rule(&router, &to, &p.id, "late and urgent", json!({ "overdue": {} }), json!([{ "comment": "urgent and late" }]), json!({ "priorities": ["urgent"] })).await;
    let off = rule(&router, &to, &p.id, "paused", json!({ "overdue": {} }), json!([{ "comment": "never" }]), json!({})).await;
    set_mode(&router, &to, &off, "AUTOMATION_MODE_OFF").await;

    let mk = |title: &str, extra: Value| {
        let mut b = json!({ "title": title });
        b.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        let (router, to, m) = (router.clone(), to.clone(), p.m1.clone());
        async move { s(&task(&router, &to, &m, b).await, "id") }
    };
    let late = mk("late", json!({ "dueDate": "2031-06-09" })).await;
    let late_done = mk("late but done", json!({ "dueDate": "2031-06-01", "status": "DONE" })).await;
    let late_cancelled = mk("late but cancelled", json!({ "dueDate": "2031-06-01", "status": "CANCELLED" })).await;
    let due_today = mk("due today", json!({ "dueDate": today })).await;
    let in_three = mk("in three", json!({ "dueDate": "2031-06-13" })).await;
    let in_four = mk("in four", json!({ "dueDate": "2031-06-14" })).await;
    mk("no date", json!({})).await;

    let sweep = |day: &'static str| {
        let (router, ta) = (router.clone(), ta.clone());
        async move { ok(&router, &format!("{AUTO}/RunScheduledAutomations"), &ta, json!({ "today": day })).await }
    };
    let first = sweep(today).await;
    assert!(num(&first, "runs") >= 3, "the sweep reports its runs: {first}");
    let all = runs(&router, &to, &p.id).await;
    let tasks_of = |rule: &str| -> Vec<String> { runs_of(&all, rule).iter().map(|r| s(r, "taskId")).collect() };
    assert_eq!(tasks_of(&overdue), vec![late.clone()], "overdue = open tasks due before today");
    let mut s3 = tasks_of(&soon);
    s3.sort();
    let mut want = vec![due_today.clone(), in_three.clone()];
    want.sort();
    assert_eq!(s3, want, "due in 3 = today … today+3, inclusive");
    assert!(!tasks_of(&soon).contains(&in_four));
    assert!(tasks_of(&overdue).iter().all(|t| *t != late_done && *t != late_cancelled), "done and cancelled are left out");
    assert!(tasks_of(&off).is_empty(), "a paused rule never runs");
    assert!(tasks_of(&picky).is_empty(), "conditions apply to time-based rules");
    assert_eq!(runs_of(&all, &overdue)[0]["trigger"], "overdue");
    assert_eq!(strs(&get(&router, &to, &late).await, "labelIds"), vec![p.l1.clone()]);

    // Once per (rule, task, due date).
    sweep(today).await;
    let all2 = runs(&router, &to, &p.id).await;
    assert_eq!(all2.len(), all.len(), "a second sweep the same day runs nothing new");
    // Conditions are checked before the claim: matching later still fires.
    update(&router, &to, json!({ "id": late, "priority": "URGENT" })).await;
    sweep(today).await;
    let all3 = runs(&router, &to, &p.id).await;
    assert_eq!(runs_of(&all3, &picky).len(), 1, "the task became urgent, so the picky rule runs now");
    assert_eq!(runs_of(&all3, &overdue).len(), 1, "the plain overdue rule did not run again");
    // A new due date re-arms the rule.
    update(&router, &to, json!({ "id": late, "dueDate": "2031-06-08" })).await;
    sweep(today).await;
    let all4 = runs(&router, &to, &p.id).await;
    assert_eq!(runs_of(&all4, &overdue).len(), 2, "moving the due date re-arms it");
}

#[tokio::test]
async fn run_history_is_newest_first_limited_and_goes_with_its_rule() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);
    let p = proj(&router, &owner, &[]).await;
    let r = rule(&router, &to, &p.id, "noisy", json!({ "taskCreated": {} }), json!([{ "comment": "x" }]), json!({})).await;
    let r2 = rule(&router, &to, &p.id, "quiet", json!({ "taskCreated": {} }), json!([{ "comment": "y" }]), json!({ "priorities": ["urgent"] })).await;
    let mut ids = Vec::new();
    for i in 0..3 {
        ids.push(s(&task(&router, &to, &p.m1, json!({ "title": format!("t{i}") })).await, "id"));
    }
    task(&router, &to, &p.m1, json!({ "title": "u", "priority": "URGENT" })).await;
    let all = runs(&router, &to, &p.id).await;
    let mine: Vec<String> = runs_of(&all, &r).iter().map(|x| s(x, "taskId")).collect();
    assert_eq!(mine.len(), 4);
    assert_eq!(mine[1..], [ids[2].clone(), ids[1].clone(), ids[0].clone()], "newest first");
    let first = runs_of(&all, &r)[3].clone();
    assert_eq!(first["taskTitle"], "t0");
    assert_eq!(first["automationName"], "noisy");
    assert!(num(&first, "taskNumber") > 0);
    let limited = ok(&router, &format!("{AUTO}/ListAutomationRuns"), &to, json!({ "projectId": p.id, "limit": 2 })).await;
    assert_eq!(arr(&limited, "runs").len(), 2, "limit applies");
    let one = ok(&router, &format!("{AUTO}/ListAutomationRuns"), &to, json!({ "projectId": p.id, "automationId": r2 })).await;
    assert_eq!(arr(&one, "runs").len(), 1, "filter by rule");
    let rules = ok(&router, &format!("{AUTO}/ListAutomations"), &to, json!({ "projectId": p.id })).await;
    let noisy = arr(&rules, "automations").into_iter().find(|a| s(a, "id") == r).unwrap();
    assert_eq!(num(&noisy, "runCount"), 4, "the rule shows its run count");
    assert!(noisy["lastRunAt"].is_string());

    // A deleted task leaves the run with an empty title.
    ok(&router, &format!("{TASK}/DeleteTask"), &to, json!({ "id": ids[0] })).await;
    let all = runs(&router, &to, &p.id).await;
    let gone = all.iter().find(|x| x["taskId"] == ids[0].as_str() && x["automationId"] == r.as_str()).unwrap();
    assert!(gone["taskTitle"].is_null() || gone["taskTitle"] == "", "{gone}");

    // Deleting the rule takes its runs (and claims) with it.
    ok(&router, &format!("{AUTO}/DeleteAutomation"), &to, json!({ "id": r })).await;
    let all = runs(&router, &to, &p.id).await;
    assert!(runs_of(&all, &r).is_empty(), "its runs are gone");
    assert_eq!(runs_of(&all, &r2).len(), 1, "other rules keep theirs");
    let left: i64 = sqlx::query_scalar(
        "SELECT (SELECT count(*) FROM cmp_automationrun WHERE automation_id = $1) + \
                (SELECT count(*) FROM cmp_automationfired WHERE automation_id = $1)",
    )
    .bind(&r)
    .fetch_one(store.pool())
    .await
    .unwrap();
    assert_eq!(left, 0, "no orphan run or claim rows");
}

// ── Observe mode ─────────────────────────────────────────────────────────────

/// Activity rows on a task.
async fn activity(router: &Router, tok: &str, task: &str) -> Vec<Value> {
    arr(&ok(router, &format!("{ACTIVITY}/ListEntityActivity"), tok, json!({ "entityType": "TASK", "entityId": task })).await, "activities")
}

#[tokio::test]
async fn observe_mode_says_what_it_would_do_and_changes_nothing() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, member) = (mk_user(&store).await, mk_user(&store).await);
    let (to, tm) = (token(&owner), token(&member));
    let p = proj(&router, &owner, &[&member]).await;
    let r = s(&ok(&router, &format!("{AUTO}/CreateAutomation"), &to, json!({
        "projectId": p.id, "name": "Archive done", "mode": "AUTOMATION_MODE_OBSERVE",
        "trigger": { "statusChanged": { "toStatusId": p.done } },
        "actions": [{ "moveToModuleId": p.m2 }, { "notify": { "target": "NOTIFY_TARGET_OWNER", "message": "finished" } }]
    })).await, "id");
    let auto_notes = |tok: String| {
        let router = router.clone();
        async move { notifications(&router, &tok).await.into_iter().filter(|n| n["type"] == "AUTOMATION").count() }
    };

    let t = s(&task(&router, &tm, &p.m1, json!({ "title": "Observed" })).await, "id");
    let reply = update(&router, &tm, json!({ "id": t, "statusId": p.done })).await;
    assert_eq!(reply["moduleId"], p.m1.as_str(), "observe changes nothing in the reply");
    let got = get(&router, &tm, &t).await;
    assert_eq!(got["moduleId"], p.m1.as_str(), "the task stays in its module");
    assert_eq!(auto_notes(to.clone()).await, 0, "nobody is notified");
    assert!(comments(&router, &tm, &t).await.is_empty(), "no comment");
    let act = activity(&router, &tm, &t).await;
    assert!(act.iter().all(|a| s(a, "actorId") == member && a["automationId"].is_null()), "only the person's own activity: {act:?}");
    let all = runs(&router, &tm, &p.id).await;
    let mine = runs_of(&all, &r);
    assert_eq!(mine.len(), 1, "exactly one run");
    assert_eq!(mine[0]["status"], "RUN_STATUS_OBSERVED");
    let detail = s(mine[0], "detail");
    assert!(detail.contains("would move to M2"), "the run names the move: {detail}");
    assert!(detail.contains("would notify"), "and the notification: {detail}");

    // Switched on, the next change does both.
    set_mode(&router, &to, &r, "AUTOMATION_MODE_ON").await;
    let t2 = s(&task(&router, &tm, &p.m1, json!({ "title": "For real" })).await, "id");
    update(&router, &tm, json!({ "id": t2, "statusId": p.done })).await;
    assert_eq!(get(&router, &tm, &t2).await["moduleId"], p.m2.as_str(), "on: moved");
    assert_eq!(auto_notes(to.clone()).await, 1, "on: the owner is notified");
    let latest = runs_of(&runs(&router, &tm, &p.id).await, &r)[0].clone();
    assert_eq!(latest["status"], "RUN_STATUS_OK");

    // An observer that would fail says so, and still changes nothing.
    let q = proj(&router, &owner, &[&member]).await;
    let f = s(&ok(&router, &format!("{AUTO}/CreateAutomation"), &to, json!({
        "projectId": q.id, "name": "Doomed", "mode": "AUTOMATION_MODE_OBSERVE",
        "trigger": { "taskCreated": {} },
        "actions": [{ "moveToModuleId": q.m2 }, { "notify": { "target": "NOTIFY_TARGET_USER", "userId": member, "message": "x" } }]
    })).await, "id");
    ok(&router, &format!("{MODULE}/DeleteModule"), &to, json!({ "id": q.m2 })).await;
    ok(&router, &format!("{PROJECT}/RemoveProjectMember"), &to, json!({ "projectId": q.id, "userId": member })).await;
    task(&router, &to, &q.m1, json!({ "title": "x" })).await;
    let run = runs_of(&runs(&router, &to, &q.id).await, &f)[0].clone();
    assert_eq!(run["status"], "RUN_STATUS_OBSERVED");
    let detail = s(&run, "detail");
    assert!(detail.matches("would fail").count() >= 2, "both the gone module and the ex-member are called out: {detail}");
}

#[tokio::test]
async fn an_observer_neither_chains_nor_spends_the_budget() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);
    let p = proj(&router, &owner, &[]).await;
    let five = json!([{ "comment": "1" }, { "comment": "2" }, { "comment": "3" }, { "comment": "4" }, { "comment": "5" }]);
    // The observer is created first, so it would be first to spend the budget.
    let obs = s(&ok(&router, &format!("{AUTO}/CreateAutomation"), &to, json!({
        "projectId": p.id, "name": "watcher", "mode": "AUTOMATION_MODE_OBSERVE", "trigger": { "taskCreated": {} },
        "actions": [{ "setStatusId": p.in_progress }, { "comment": "a" }, { "comment": "b" }, { "comment": "c" }, { "comment": "d" }]
    })).await, "id");
    let r1 = rule(&router, &to, &p.id, "r1", json!({ "taskCreated": {} }), five.clone(), json!({})).await;
    let r2 = rule(&router, &to, &p.id, "r2", json!({ "taskCreated": {} }), five, json!({})).await;
    // Would be chained to by the observer's status change, if observers chained.
    let chained = rule(&router, &to, &p.id, "on start", json!({ "statusChanged": { "toStatusId": p.in_progress } }), json!([{ "comment": "chained" }]), json!({})).await;
    let t = s(&task(&router, &to, &p.m1, json!({ "title": "Busy" })).await, "id");
    let all = runs(&router, &to, &p.id).await;
    assert_eq!(runs_of(&all, &obs)[0]["status"], "RUN_STATUS_OBSERVED");
    assert_eq!(runs_of(&all, &r1)[0]["status"], "RUN_STATUS_OK");
    assert_eq!(runs_of(&all, &r2)[0]["status"], "RUN_STATUS_OK", "the observer spent none of the budget");
    assert!(runs_of(&all, &chained).is_empty(), "an observer's would-be change triggers nothing");
    assert_eq!(comments(&router, &to, &t).await.len(), 10, "exactly the two real rules' ten comments");
    assert_eq!(get(&router, &to, &t).await["statusId"], p.todo.as_str(), "the observer did not move the status");
}

#[tokio::test]
async fn observed_time_based_rules_claim_separately_from_real_fires() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, admin) = (mk_user(&store).await, mk_user(&store).await);
    let (to, ta) = (token(&owner), admin_token(&admin));
    let p = proj(&router, &owner, &[]).await;
    let today = "2032-03-10";
    let r = s(&ok(&router, &format!("{AUTO}/CreateAutomation"), &to, json!({
        "projectId": p.id, "name": "late flag", "mode": "AUTOMATION_MODE_OBSERVE",
        "trigger": { "overdue": {} }, "actions": [{ "addLabelId": p.l1 }]
    })).await, "id");
    let a = s(&task(&router, &to, &p.m1, json!({ "title": "late a", "dueDate": "2032-03-01" })).await, "id");
    let b = s(&task(&router, &to, &p.m1, json!({ "title": "late b", "dueDate": "2032-03-05" })).await, "id");
    let sweep = || {
        let (router, ta) = (router.clone(), ta.clone());
        async move { ok(&router, &format!("{AUTO}/RunScheduledAutomations"), &ta, json!({ "today": today })).await }
    };
    sweep().await;
    sweep().await;
    let mine: Vec<Value> = runs_of(&runs(&router, &to, &p.id).await, &r).into_iter().cloned().collect();
    assert_eq!(mine.len(), 2, "one observed run per task and due date, across sweeps: {mine:?}");
    assert!(mine.iter().all(|x| x["status"] == "RUN_STATUS_OBSERVED"));
    assert!(strs(&get(&router, &to, &a).await, "labelIds").is_empty(), "observe added no label");

    set_mode(&router, &to, &r, "AUTOMATION_MODE_ON").await;
    sweep().await;
    let mine: Vec<Value> = runs_of(&runs(&router, &to, &p.id).await, &r).into_iter().cloned().collect();
    assert_eq!(mine.iter().filter(|x| x["status"] == "RUN_STATUS_OK").count(), 2, "on: the next sweep acts on the tasks it only observed");
    for t in [&a, &b] {
        assert_eq!(strs(&get(&router, &to, t).await, "labelIds"), vec![p.l1.clone()]);
    }
    sweep().await;
    assert_eq!(runs_of(&runs(&router, &to, &p.id).await, &r).len(), 4, "and only once");
}

// ── Provenance and the Automation identity ──────────────────────────────────

#[tokio::test]
async fn chained_rows_carry_their_own_rule_and_survive_its_deletion() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);
    let p = proj(&router, &owner, &[]).await;
    let starter = rule(&router, &to, &p.id, "starter", json!({ "taskCreated": {} }), json!([{ "setStatusId": p.in_progress }]), json!({})).await;
    let follower = rule(&router, &to, &p.id, "follower", json!({ "statusChanged": { "toStatusId": p.in_progress } }), json!([{ "comment": "on it" }]), json!({})).await;
    let t = s(&task(&router, &to, &p.m1, json!({ "title": "Chain" })).await, "id");
    let c = comments(&router, &to, &t).await;
    assert_eq!(c.len(), 1);
    assert_eq!(c[0]["automationId"], follower.as_str(), "the chained rule's comment carries the chained rule");
    let act = activity(&router, &to, &t).await;
    let sys = system_id(&store).await;
    assert!(act.iter().any(|a| a["automationId"] == starter.as_str() && s(a, "actorId") == sys), "the status change carries the starter: {act:?}");
    assert!(act.iter().any(|a| s(a, "actorId") == owner && a["automationId"].is_null()), "the creation is the person's own: {act:?}");

    // A manual change has no provenance.
    ok(&router, &format!("{COMMENT}/CreateComment"), &to, json!({ "taskId": t, "content": "by hand" })).await;
    let c = comments(&router, &to, &t).await;
    let manual = c.iter().find(|x| x["content"] == "by hand").unwrap();
    assert!(manual["automationId"].is_null(), "manual comments are untagged: {manual}");

    // Deleting the rule keeps the trace but loses the name.
    ok(&router, &format!("{AUTO}/DeleteAutomation"), &to, json!({ "id": follower })).await;
    let c = comments(&router, &to, &t).await;
    let auto = c.iter().find(|x| x["content"] == "<p>on it</p>").unwrap();
    assert_eq!(auto["automationId"], follower.as_str());
    assert!(auto["automationName"].is_null() || auto["automationName"] == "", "a deleted rule has no name: {auto}");
}

#[tokio::test]
async fn the_automation_identity_acts_only_as_a_project_member() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, member, admin) = (mk_user(&store).await, mk_user(&store).await, mk_user(&store).await);
    let (to, ta) = (token(&owner), admin_token(&admin));
    let p = proj(&router, &owner, &[&member]).await;
    let sys = system_id(&store).await;

    // People leave; rules that name them fail with a reason.
    let assign = rule(&router, &to, &p.id, "assign M", json!({ "taskCreated": {} }), json!([{ "assignUserId": member }]), json!({})).await;
    let tell = rule(&router, &to, &p.id, "tell M", json!({ "taskCreated": {} }),
        json!([{ "notify": { "target": "NOTIFY_TARGET_USER", "userId": member, "message": "hey" } }]), json!({})).await;
    ok(&router, &format!("{PROJECT}/RemoveProjectMember"), &to, json!({ "projectId": p.id, "userId": member })).await;
    let t = s(&task(&router, &to, &p.m1, json!({ "title": "after M left" })).await, "id");
    let all = runs(&router, &to, &p.id).await;
    for (r, why) in [(&assign, "assign"), (&tell, "notify")] {
        let run = runs_of(&all, r)[0];
        assert_eq!(run["status"], "RUN_STATUS_FAILED", "{why} a non-member fails: {run}");
        assert!(!s(run, "detail").is_empty());
    }
    assert!(strs(&get(&router, &to, &t).await, "assigneeIds").is_empty(), "nobody was assigned");
    let notes = notifications(&router, &token(&member)).await;
    assert!(notes.iter().all(|n| n["message"] != "hey" && n["automationName"] != "tell M"), "the ex-member is not notified");

    // The identity is invisible to people: not in the directory, not assignable, not a member.
    let list = ok(&router, &format!("{DIR}/ListUsers"), &ta, json!({ "pageSize": 1000 })).await;
    assert!(arr(&list, "users").iter().all(|u| s(u, "id") != sys), "not in ListUsers");
    let found = ok(&router, &format!("{DIR}/SearchUsers"), &to, json!({ "q": "Automation" })).await;
    assert!(arr(&found, "users").iter().all(|u| s(u, "id") != sys), "not in the picker search");
    fails(&router, &format!("{TASK}/UpdateTask"), &to, json!({ "id": t, "assigneeIds": { "values": [sys] } }), "invalid_argument").await;
    let members = ok(&router, &format!("{PROJECT}/ListProjectMembers"), &to, json!({ "projectId": p.id })).await;
    assert!(arr(&members, "members").iter().all(|m| s(m, "userId") != sys), "not a project member");
    let (st, v) = call(&router, &format!("{PROJECT}/AddProjectMember"), Some(&to), json!({ "projectId": p.id, "userId": sys })).await;
    assert_ne!(st, StatusCode::OK, "the Automation identity cannot be added to a project: {v}");
    // It can never act through a personal access token (MCP resolves a token's owner here).
    assert!(transport::api::auth_user_for(&store, &sys).await.unwrap().is_none(), "a token owned by the system identity resolves to nobody");
    assert!(transport::api::auth_user_for(&store, &owner).await.unwrap().is_some(), "while a person's does");
}

#[tokio::test]
async fn rules_never_fire_in_template_projects() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, admin) = (mk_user(&store).await, mk_user(&store).await);
    let to = token(&owner);
    let p = proj(&router, &owner, &[]).await;
    let on_create = rule(&router, &to, &p.id, "on create", json!({ "taskCreated": {} }), json!([{ "comment": "hi" }]), json!({})).await;
    let late = rule(&router, &to, &p.id, "late", json!({ "overdue": {} }), json!([{ "comment": "late" }]), json!({})).await;
    ok(&router, &format!("{PROJECT}/SetProjectTemplate"), &to, json!({ "id": p.id, "isTemplate": true })).await;
    let t = s(&task(&router, &to, &p.m1, json!({ "title": "in a template", "dueDate": "2033-01-01" })).await, "id");
    ok(&router, &format!("{AUTO}/RunScheduledAutomations"), &admin_token(&admin), json!({ "today": "2033-01-10" })).await;
    let all = runs(&router, &to, &p.id).await;
    assert!(runs_of(&all, &on_create).is_empty(), "no change-triggered run in a template");
    assert!(runs_of(&all, &late).is_empty(), "no time-based run in a template");
    assert!(comments(&router, &to, &t).await.is_empty());
}

#[tokio::test]
async fn real_and_observed_runs_are_counted_apart() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, member) = (mk_user(&store).await, mk_user(&store).await);
    let to = token(&owner);
    let p = proj(&router, &owner, &[&member]).await;
    let r = rule(&router, &to, &p.id, "assign M", json!({ "taskCreated": {} }), json!([{ "assignUserId": member }]), json!({})).await;
    let rule_row = || {
        let (router, to, pid, r) = (router.clone(), to.clone(), p.id.clone(), r.clone());
        async move {
            let l = ok(&router, &format!("{AUTO}/ListAutomations"), &to, json!({ "projectId": pid })).await;
            arr(&l, "automations").into_iter().find(|a| s(a, "id") == r).unwrap()
        }
    };
    let fresh = rule_row().await;
    assert_eq!(num(&fresh, "runCount"), 0);
    assert_eq!(num(&fresh, "observedCount"), 0);
    assert!(fresh["lastRunAt"].is_null() && fresh["lastObservedAt"].is_null(), "nothing yet: {fresh}");

    // 2 OK, then 1 FAILED (the member left), then 4 OBSERVED.
    for i in 0..2 {
        task(&router, &to, &p.m1, json!({ "title": format!("ok {i}") })).await;
    }
    ok(&router, &format!("{PROJECT}/RemoveProjectMember"), &to, json!({ "projectId": p.id, "userId": member })).await;
    task(&router, &to, &p.m1, json!({ "title": "fails" })).await;
    let mid = rule_row().await;
    assert_eq!(num(&mid, "runCount"), 3, "OK and FAILED runs both count as real runs");
    assert!(mid["lastObservedAt"].is_null());
    set_mode(&router, &to, &r, "AUTOMATION_MODE_OBSERVE").await;
    for i in 0..4 {
        task(&router, &to, &p.m1, json!({ "title": format!("watched {i}") })).await;
    }
    let row = rule_row().await;
    assert_eq!(num(&row, "runCount"), 3, "observed runs are not runs");
    assert_eq!(num(&row, "observedCount"), 4);
    assert!(row["lastObservedAt"].is_string(), "{row}");
    assert!(row["lastRunAt"].is_string(), "{row}");
    assert!(s(&row, "lastRunAt") < s(&row, "lastObservedAt"), "last_run_at is the latest real run, before the observations: {row}");
    assert_eq!(row["lastRunAt"], mid["lastRunAt"], "observing does not move last_run_at");
    let statuses: Vec<String> = runs_of(&runs(&router, &to, &p.id).await, &r).iter().map(|x| s(x, "status")).collect();
    assert_eq!(statuses.iter().filter(|x| *x == "RUN_STATUS_OK").count(), 2);
    assert_eq!(statuses.iter().filter(|x| *x == "RUN_STATUS_FAILED").count(), 1);
    assert_eq!(statuses.iter().filter(|x| *x == "RUN_STATUS_OBSERVED").count(), 4);

    // An observe-only rule.
    let o = s(&ok(&router, &format!("{AUTO}/CreateAutomation"), &to, json!({
        "projectId": p.id, "name": "just watching", "mode": "AUTOMATION_MODE_OBSERVE",
        "trigger": { "taskCreated": {} }, "actions": [{ "comment": "x" }]
    })).await, "id");
    task(&router, &to, &p.m1, json!({ "title": "seen" })).await;
    let l = ok(&router, &format!("{AUTO}/ListAutomations"), &to, json!({ "projectId": p.id })).await;
    let only = arr(&l, "automations").into_iter().find(|a| s(a, "id") == o).unwrap();
    assert_eq!(num(&only, "runCount"), 0, "observe-only: no real run");
    assert_eq!(num(&only, "observedCount"), 1);
    assert!(only["lastRunAt"].is_null(), "no real run, no last_run_at: {only}");
    assert!(only["lastObservedAt"].is_string());
}
