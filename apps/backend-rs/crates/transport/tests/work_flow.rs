//! End-to-end Modules & Tasks over the real Connect routers + Postgres.
//! Skipped unless `DATABASE_URL` is set. Unique ids so reruns stay isolated.

use std::sync::Arc;

use auth::{sign_jwt, verify_jwt};
use axum::body::{to_bytes, Body};
use axum::extract::Request;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::StatusCode;
use axum::middleware::{from_fn, Next};
use axum::response::Response;
use axum::Router;
use domain::user::{UserPassword, UserPhone, UserProfile, UserStatusComponent};
use persistence::Store;
use serde_json::{json, Value};
use tower::ServiceExt;

const SECRET: &str = "test-secret";
const PROJECT: &str = "/sedjiwa.tasks.project.v1.ProjectService";
const MODULE: &str = "/sedjiwa.tasks.work.v1.ModuleService";
const TASK: &str = "/sedjiwa.tasks.work.v1.TaskService";

fn uniq() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos()
        .to_string()
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
    let store = Arc::new(Store::connect(&url, domain::register_all).await.unwrap());
    let router = transport::project_router(store.clone())
        .merge(transport::module_router(store.clone()))
        .merge(transport::task_router(store.clone()))
        .layer(from_fn(auth_mw));
    Some((router, store))
}

fn token(sub: &str) -> String {
    sign_jwt(SECRET, sub, &["projects:create".to_string()], 9_999_999_999).unwrap()
}

async fn call(router: &Router, path: &str, token: Option<&str>, body: Value) -> (StatusCode, Value) {
    let mut b = Request::builder()
        .method("POST")
        .uri(path)
        .header(CONTENT_TYPE, "application/json");
    if let Some(t) = token {
        b = b.header(AUTHORIZATION, format!("Bearer {t}"));
    }
    let req = b.body(Body::from(body.to_string())).unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

async fn ok(router: &Router, path: &str, tok: &str, body: Value) -> Value {
    let (st, v) = call(router, path, Some(tok), body).await;
    assert_eq!(st, StatusCode::OK, "{path}: {v}");
    v
}

/// Numeric field, defaulting to 0 (proto3 JSON omits zero-valued scalars).
fn num(body: &Value, key: &str) -> i64 {
    body[key].as_i64().unwrap_or(0)
}

/// Create a real Active user; return its pid string.
async fn mk_user(store: &Store) -> String {
    let now = "2026-01-01T00:00:00Z".to_string();
    store
        .create((
            UserPhone { value: format!("m{}", uniq()), verified: true },
            UserPassword { hash: "x".into(), changed_at: now.clone() },
            UserProfile { display_name: "M".into(), avatar_url: String::new(), email: String::new() },
            UserStatusComponent { status: "active".into(), created_at: now, last_login_at: None },
        ))
        .await
        .unwrap()
        .to_string()
}

/// Owner creates a project and adds `members`; returns project id.
async fn project_with(router: &Router, owner: &str, members: &[&str]) -> String {
    let p = ok(router, &format!("{PROJECT}/CreateProject"), &token(owner), json!({ "name": format!("P{}", uniq()) })).await;
    let id = p["id"].as_str().unwrap().to_string();
    for m in members {
        ok(router, &format!("{PROJECT}/AddProjectMember"), &token(owner), json!({ "projectId": id, "userId": m })).await;
    }
    id
}

#[tokio::test]
async fn modules_lifecycle() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let member = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[&member]).await;
    let to = token(&owner);

    // Create two modules → append order 0,1.
    let m1 = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": pid, "name": "Backlog" })).await;
    assert_eq!(num(&m1, "order"), 0);
    let m2 = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": pid, "name": "Sprint" })).await;
    assert_eq!(num(&m2, "order"), 1);
    let (m1id, m2id) = (m1["id"].as_str().unwrap().to_string(), m2["id"].as_str().unwrap().to_string());

    // Member can list (member-gated).
    let list = ok(&router, &format!("{MODULE}/ListModules"), &token(&member), json!({ "projectId": pid })).await;
    let names: Vec<&str> = list["modules"].as_array().unwrap().iter().map(|m| m["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec!["Backlog", "Sprint"]);

    // Member (non-owner) cannot create a module.
    let (st, _) = call(&router, &format!("{MODULE}/CreateModule"), Some(&token(&member)), json!({ "projectId": pid, "name": "X" })).await;
    assert_ne!(st, StatusCode::OK, "non-owner cannot create module");

    // Update name.
    let upd = ok(&router, &format!("{MODULE}/UpdateModule"), &to, json!({ "id": m1id, "name": "Todo" })).await;
    assert_eq!(upd["name"], "Todo");

    // Reorder → Sprint first.
    let re = ok(&router, &format!("{MODULE}/ReorderModules"), &to, json!({ "projectId": pid, "moduleIds": [m2id, m1id] })).await;
    let ordered: Vec<&str> = re["modules"].as_array().unwrap().iter().map(|m| m["name"].as_str().unwrap()).collect();
    assert_eq!(ordered, vec!["Sprint", "Todo"], "reordered by moduleIds");
}

#[tokio::test]
async fn tasks_lifecycle_and_rules() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let member = mk_user(&store).await;
    let outsider = mk_user(&store).await; // real user, not a project member
    let pid = project_with(&router, &owner, &[&member]).await;
    let to = token(&owner);
    let tm = token(&member);

    let backlog = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": pid, "name": "Backlog" })).await["id"].as_str().unwrap().to_string();
    let sprint = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": pid, "name": "Sprint" })).await["id"].as_str().unwrap().to_string();

    // Member creates a task (default status TODO), append order 0.
    let t1 = ok(&router, &format!("{TASK}/CreateTask"), &tm, json!({ "moduleId": backlog, "title": "  First  " })).await;
    assert_eq!(t1["title"], "First");
    assert_eq!(t1["status"], "TODO");
    assert_eq!(num(&t1, "order"), 0);
    let t1id = t1["id"].as_str().unwrap().to_string();
    let t2 = ok(&router, &format!("{TASK}/CreateTask"), &tm, json!({ "moduleId": backlog, "title": "Second" })).await;
    assert_eq!(num(&t2, "order"), 1);
    let t2id = t2["id"].as_str().unwrap().to_string();

    // Assignee must be a member: outsider rejected, member accepted.
    let (st, _) = call(&router, &format!("{TASK}/CreateTask"), Some(&tm), json!({ "moduleId": backlog, "title": "Nope", "assigneeIds": [outsider] })).await;
    assert_ne!(st, StatusCode::OK, "non-member assignee rejected");
    let t3 = ok(&router, &format!("{TASK}/CreateTask"), &tm, json!({ "moduleId": backlog, "title": "Assigned", "assigneeIds": [member] })).await;
    assert_eq!(t3["assigneeIds"], json!([member]));

    // completed_at automation: →DONE sets it, leaving DONE clears it.
    let done = ok(&router, &format!("{TASK}/UpdateTask"), &tm, json!({ "id": t1id, "status": "DONE" })).await;
    assert_eq!(done["status"], "DONE");
    assert!(done["completedAt"].is_string(), "completedAt set on Done");
    let reopened = ok(&router, &format!("{TASK}/UpdateTask"), &tm, json!({ "id": t1id, "status": "TODO" })).await;
    assert!(reopened["completedAt"].is_null(), "completedAt cleared leaving Done");

    // Partial update (assignee_ids absent) keeps assignees.
    let t3id = t3["id"].as_str().unwrap().to_string();
    let patched = ok(&router, &format!("{TASK}/UpdateTask"), &tm, json!({ "id": t3id, "title": "Assigned+" })).await;
    assert_eq!(patched["title"], "Assigned+");
    assert_eq!(patched["assigneeIds"], json!([member]), "assignees unchanged when omitted");
    // Explicit empty clears.
    let cleared = ok(&router, &format!("{TASK}/UpdateTask"), &tm, json!({ "id": t3id, "assigneeIds": { "values": [] } })).await;
    // Empty repeated field is omitted from proto3 JSON → absent means cleared.
    assert!(
        cleared["assigneeIds"].as_array().map(|a| a.is_empty()).unwrap_or(true),
        "empty StringList clears assignees"
    );

    // Move t1 to Sprint.
    let moved = ok(&router, &format!("{TASK}/MoveTask"), &tm, json!({ "id": t1id, "moduleId": sprint, "order": 3 })).await;
    assert_eq!(moved["moduleId"], sprint);
    assert_eq!(num(&moved, "order"), 3);

    // List by project → all 3; by module Backlog → t2,t3 (t1 moved out).
    let all = ok(&router, &format!("{TASK}/ListTasks"), &tm, json!({ "projectId": pid })).await;
    assert_eq!(all["tasks"].as_array().unwrap().len(), 3);
    let in_backlog = ok(&router, &format!("{TASK}/ListTasks"), &tm, json!({ "projectId": pid, "moduleId": backlog })).await;
    let ids: Vec<&str> = in_backlog["tasks"].as_array().unwrap().iter().map(|t| t["id"].as_str().unwrap()).collect();
    assert!(ids.contains(&t2id.as_str()) && ids.contains(&t3id.as_str()) && !ids.contains(&t1id.as_str()));

    // Non-member cannot list.
    let (st, _) = call(&router, &format!("{TASK}/ListTasks"), Some(&token(&outsider)), json!({ "projectId": pid })).await;
    assert_ne!(st, StatusCode::OK, "non-member cannot list tasks");

    // Delete module Backlog cascades its tasks (t2, t3); t1 (in Sprint) survives.
    ok(&router, &format!("{MODULE}/DeleteModule"), &to, json!({ "id": backlog })).await;
    let after = ok(&router, &format!("{TASK}/ListTasks"), &tm, json!({ "projectId": pid })).await;
    let remaining: Vec<&str> = after["tasks"].as_array().unwrap().iter().map(|t| t["id"].as_str().unwrap()).collect();
    assert_eq!(remaining, vec![t1id.as_str()], "only the moved task survives the cascade");
}

// Timeline tab is a frontend-only view over ListModules/ListTasks/UpdateTask; the
// only backend contract it needs is date reschedule via UpdateTask. This locks
// that in: schedule-from-unscheduled, preserve-duration shift, left/right resize,
// field preservation, the start<=due invariant, and unschedule.
#[tokio::test]
async fn timeline_reschedule_via_update_task() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let member = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[&member]).await;
    let to = token(&owner);
    let tm = token(&member);
    let m = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": pid, "name": "Plan" })).await["id"].as_str().unwrap().to_string();

    // Unscheduled task (no dates).
    let t = ok(&router, &format!("{TASK}/CreateTask"), &tm, json!({ "moduleId": m, "title": "Design", "assigneeIds": [member] })).await;
    let tid = t["id"].as_str().unwrap().to_string();
    assert!(t["startDate"].is_null() && t["dueDate"].is_null(), "starts unscheduled");

    // Schedule from unscheduled: set both; other fields preserved.
    let sched = ok(&router, &format!("{TASK}/UpdateTask"), &tm, json!({ "id": tid, "startDate": "2026-03-01", "dueDate": "2026-03-05" })).await;
    assert_eq!(sched["startDate"], "2026-03-01");
    assert_eq!(sched["dueDate"], "2026-03-05");
    assert_eq!(sched["title"], "Design");
    assert_eq!(sched["assigneeIds"], json!([member]), "assignees preserved on reschedule");

    // Preserve-duration shift (both new dates).
    let shifted = ok(&router, &format!("{TASK}/UpdateTask"), &tm, json!({ "id": tid, "startDate": "2026-03-03", "dueDate": "2026-03-07" })).await;
    assert_eq!(shifted["startDate"], "2026-03-03");
    assert_eq!(shifted["dueDate"], "2026-03-07");

    // Left-resize: change only start; due unchanged.
    let lr = ok(&router, &format!("{TASK}/UpdateTask"), &tm, json!({ "id": tid, "startDate": "2026-03-02" })).await;
    assert_eq!(lr["startDate"], "2026-03-02");
    assert_eq!(lr["dueDate"], "2026-03-07", "due unchanged on left-resize");

    // Right-resize: change only due; start unchanged.
    let rr = ok(&router, &format!("{TASK}/UpdateTask"), &tm, json!({ "id": tid, "dueDate": "2026-03-10" })).await;
    assert_eq!(rr["startDate"], "2026-03-02", "start unchanged on right-resize");
    assert_eq!(rr["dueDate"], "2026-03-10");

    // Invariant: start after due rejected (update + create).
    let (st, _) = call(&router, &format!("{TASK}/UpdateTask"), Some(&tm), json!({ "id": tid, "startDate": "2026-03-20", "dueDate": "2026-03-10" })).await;
    assert_ne!(st, StatusCode::OK, "start after due rejected on update");
    let (st, _) = call(&router, &format!("{TASK}/CreateTask"), Some(&tm), json!({ "moduleId": m, "title": "Bad", "startDate": "2026-05-05", "dueDate": "2026-05-01" })).await;
    assert_ne!(st, StatusCode::OK, "start after due rejected on create");

    // Unschedule: clear both → back to unscheduled.
    let un = ok(&router, &format!("{TASK}/UpdateTask"), &tm, json!({ "id": tid, "startDate": "", "dueDate": "" })).await;
    assert!(un["startDate"].is_null() && un["dueDate"].is_null(), "cleared → unscheduled");
}

#[tokio::test]
async fn get_task_is_member_gated() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let outsider = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[]).await;
    let to = token(&owner);
    let m = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": pid, "name": "M" }))
        .await["id"].as_str().unwrap().to_string();
    let task = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m, "title": "Deep" }))
        .await["id"].as_str().unwrap().to_string();

    let got = ok(&router, &format!("{TASK}/GetTask"), &to, json!({ "id": task })).await;
    assert_eq!(got["id"], task);
    assert_eq!(got["title"], "Deep");
    assert_eq!(got["moduleId"], m, "the dialog needs the module to render");

    let (st, _) = call(&router, &format!("{TASK}/GetTask"), Some(&token(&outsider)), json!({ "id": task })).await;
    assert_ne!(st, StatusCode::OK, "non-member denied");

    let (st, _) = call(&router, &format!("{TASK}/GetTask"), Some(&to), json!({ "id": "999999999" })).await;
    assert_ne!(st, StatusCode::OK, "unknown id is not found");
}

#[tokio::test]
async fn subtask_rules_are_enforced() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[]).await;
    let to = token(&owner);
    let m1 = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": pid, "name": "M1" })).await["id"].as_str().unwrap().to_string();
    let m2 = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": pid, "name": "M2" })).await["id"].as_str().unwrap().to_string();

    let parent = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m1, "title": "Parent" })).await["id"].as_str().unwrap().to_string();

    // A subtask takes its parent's module even when the request names another.
    let sub = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({
        "moduleId": m2, "title": "Sub", "parentId": parent
    })).await;
    assert_eq!(sub["parentId"], parent);
    assert_eq!(sub["moduleId"], m1, "subtask follows its parent's module, not the request");
    let sub_id = sub["id"].as_str().unwrap().to_string();

    // One level: a subtask cannot be a parent, on create...
    let (st, _) = call(&router, &format!("{TASK}/CreateTask"), Some(&to), json!({
        "moduleId": m1, "title": "Grandchild", "parentId": sub_id
    })).await;
    assert_ne!(st, StatusCode::OK, "a subtask cannot have subtasks");

    // ...and on update.
    let other = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m1, "title": "Other" })).await["id"].as_str().unwrap().to_string();
    let (st, _) = call(&router, &format!("{TASK}/UpdateTask"), Some(&to), json!({
        "id": other, "parentIdSet": { "values": [sub_id] }
    })).await;
    assert_ne!(st, StatusCode::OK, "cannot re-parent under a subtask");

    // A task cannot parent itself.
    let (st, _) = call(&router, &format!("{TASK}/UpdateTask"), Some(&to), json!({
        "id": other, "parentIdSet": { "values": [other] }
    })).await;
    assert_ne!(st, StatusCode::OK, "self-parenting rejected");

    // Re-parent: absent leaves alone, empty detaches, one element sets.
    let unchanged = ok(&router, &format!("{TASK}/UpdateTask"), &to, json!({ "id": sub_id, "title": "Sub renamed" })).await;
    assert_eq!(unchanged["parentId"], parent, "absent parentIdSet leaves the parent alone");

    let detached = ok(&router, &format!("{TASK}/UpdateTask"), &to, json!({
        "id": sub_id, "parentIdSet": { "values": [] }
    })).await;
    assert!(detached["parentId"].is_null(), "empty list detaches to top level");

    let reattached = ok(&router, &format!("{TASK}/UpdateTask"), &to, json!({
        "id": sub_id, "parentIdSet": { "values": [parent] }
    })).await;
    assert_eq!(reattached["parentId"], parent, "one element sets the parent");

    // Moving the parent moves its subtasks.
    ok(&router, &format!("{TASK}/MoveTask"), &to, json!({ "id": parent, "moduleId": m2, "order": 0 })).await;
    let moved_sub = ok(&router, &format!("{TASK}/GetTask"), &to, json!({ "id": sub_id })).await;
    assert_eq!(moved_sub["moduleId"], m2, "subtask followed its parent to the new module");

    // Deleting the parent deletes its subtasks.
    ok(&router, &format!("{TASK}/DeleteTask"), &to, json!({ "id": parent })).await;
    let (st, _) = call(&router, &format!("{TASK}/GetTask"), Some(&to), json!({ "id": sub_id })).await;
    assert_ne!(st, StatusCode::OK, "subtask deleted with its parent");
}

#[tokio::test]
async fn dependency_rules_are_enforced() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let p1 = project_with(&router, &owner, &[]).await;
    let p2 = project_with(&router, &owner, &[]).await;
    let to = token(&owner);
    let m1 = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": p1, "name": "M" })).await["id"].as_str().unwrap().to_string();
    let m2 = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": p2, "name": "M" })).await["id"].as_str().unwrap().to_string();

    let a = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m1, "title": "A" })).await["id"].as_str().unwrap().to_string();
    let b = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m1, "title": "B" })).await["id"].as_str().unwrap().to_string();
    let foreign = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m2, "title": "Foreign" })).await["id"].as_str().unwrap().to_string();

    // Set and read back.
    let updated = ok(&router, &format!("{TASK}/UpdateTask"), &to, json!({
        "id": b, "blockedByIds": { "values": [a] }
    })).await;
    assert_eq!(updated["blockedByIds"], json!([a]));

    // Absent leaves it alone; empty clears it.
    let untouched = ok(&router, &format!("{TASK}/UpdateTask"), &to, json!({ "id": b, "title": "B2" })).await;
    assert_eq!(untouched["blockedByIds"], json!([a]), "absent wrapper leaves dependencies alone");
    let cleared = ok(&router, &format!("{TASK}/UpdateTask"), &to, json!({
        "id": b, "blockedByIds": { "values": [] }
    })).await;
    assert!(
        cleared["blockedByIds"].as_array().map(|a| a.is_empty()).unwrap_or(true),
        "empty wrapper clears"
    );

    // Self-dependency and cross-project are rejected.
    let (st, _) = call(&router, &format!("{TASK}/UpdateTask"), Some(&to), json!({
        "id": b, "blockedByIds": { "values": [b] }
    })).await;
    assert_ne!(st, StatusCode::OK, "self-dependency rejected");
    let (st, _) = call(&router, &format!("{TASK}/UpdateTask"), Some(&to), json!({
        "id": b, "blockedByIds": { "values": [foreign] }
    })).await;
    assert_ne!(st, StatusCode::OK, "cross-project dependency rejected");

    // A cycle is ACCEPTED. Nothing walks the graph, so it cannot hang; the user
    // sees both arrows and both conflict marks and judges for themselves.
    ok(&router, &format!("{TASK}/UpdateTask"), &to, json!({ "id": b, "blockedByIds": { "values": [a] } })).await;
    let a_now = ok(&router, &format!("{TASK}/UpdateTask"), &to, json!({ "id": a, "blockedByIds": { "values": [b] } })).await;
    assert_eq!(a_now["blockedByIds"], json!([b]), "a cycle is allowed by design");

    // Deleting a task strips it from other tasks' dependencies.
    ok(&router, &format!("{TASK}/DeleteTask"), &to, json!({ "id": a })).await;
    let b_after = ok(&router, &format!("{TASK}/GetTask"), &to, json!({ "id": b })).await;
    assert!(
        b_after["blockedByIds"].as_array().map(|a| a.is_empty()).unwrap_or(true),
        "dangling dependency removed on delete"
    );
}
