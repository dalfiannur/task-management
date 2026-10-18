//! End-to-end saved views and bulk task edits over the real Connect routers
//! + Postgres. Skipped unless `DATABASE_URL` is set.

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
const STATUS: &str = "/sedjiwa.tasks.work.v1.TaskStatusService";
const VIEW: &str = "/sedjiwa.tasks.view.v1.SavedViewService";

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
    let store = Arc::new(Store::connect(&url).await.unwrap());
    let router = transport::project_router(store.clone())
        .merge(transport::module_router(store.clone()))
        .merge(transport::task_router(store.clone()))
        .merge(transport::status_router(store.clone()))
        .merge(transport::view_router(store.clone()))
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


fn s(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or_default().to_string()
}

async fn statuses(router: &Router, tok: &str, project: &str) -> Vec<Value> {
    ok(router, &format!("{STATUS}/ListTaskStatuses"), tok, json!({ "projectId": project })).await["statuses"]
        .as_array()
        .cloned()
        .unwrap_or_default()
}

fn named<'a>(list: &'a [Value], name: &str) -> &'a Value {
    list.iter().find(|s| s["name"] == name).unwrap_or_else(|| panic!("no status {name}"))
}

async fn module(router: &Router, tok: &str, project: &str) -> String {
    s(&ok(router, &format!("{MODULE}/CreateModule"), tok, json!({ "projectId": project, "name": "M" })).await, "id")
}

/// Expect a non-OK reply carrying `code`.
async fn fails(router: &Router, path: &str, tok: &str, body: Value, code: &str) {
    let (st, v) = call(router, path, Some(tok), body).await;
    assert_ne!(st, StatusCode::OK, "{path} should fail: {v}");
    assert_eq!(v["code"], code, "{path}: {v}");
}

async fn view(router: &Router, tok: &str, body: Value) -> Value {
    ok(router, &format!("{VIEW}/CreateSavedView"), tok, body).await
}

fn names(list: &Value) -> Vec<String> {
    list["views"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|v| s(v, "name"))
        .collect()
}

#[tokio::test]
async fn saved_views_are_personal_unless_shared() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let alice = mk_user(&store).await;
    let bob = mk_user(&store).await;
    let outsider = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[&alice, &bob]).await;
    let (ta, tb, to) = (token(&alice), token(&bob), token(&owner));
    let list = |tok: String| {
        let (router, pid) = (router.clone(), pid.clone());
        async move { ok(&router, &format!("{VIEW}/ListSavedViews"), &tok, json!({ "projectId": pid })).await }
    };

    // Alice saves a personal view; the query is stored without its `?`.
    let mine = view(&router, &ta, json!({ "projectId": pid, "name": " My bugs ", "query": "?label=7&priority=high", "layout": "BOARD" })).await;
    assert_eq!(mine["name"], "My bugs");
    assert_eq!(mine["query"], "label=7&priority=high");
    assert_eq!(mine["layout"], "BOARD");
    let mine_id = s(&mine, "id");
    // And a shared one.
    let team = view(&router, &ta, json!({ "projectId": pid, "name": "Team urgent", "query": "priority=urgent", "shared": true })).await;
    assert_eq!(team["layout"], "LIST", "unspecified layout is list");
    let team_id = s(&team, "id");

    assert_eq!(names(&list(ta.clone()).await), vec!["My bugs", "Team urgent"]);
    assert_eq!(names(&list(tb.clone()).await), vec!["Team urgent"], "bob sees only the shared one");

    // Bob cannot see, edit or delete Alice's personal view; it reads as missing.
    fails(&router, &format!("{VIEW}/UpdateSavedView"), &tb, json!({ "id": mine_id, "name": "x" }), "not_found").await;
    fails(&router, &format!("{VIEW}/DeleteSavedView"), &tb, json!({ "id": mine_id }), "not_found").await;
    // Nor a shared one he does not own.
    fails(&router, &format!("{VIEW}/UpdateSavedView"), &tb, json!({ "id": team_id, "name": "x" }), "permission_denied").await;
    // The project owner may edit a shared view, but not take it private.
    let renamed = ok(&router, &format!("{VIEW}/UpdateSavedView"), &to, json!({ "id": team_id, "name": "Urgent" })).await;
    assert_eq!(renamed["name"], "Urgent");
    fails(&router, &format!("{VIEW}/UpdateSavedView"), &to, json!({ "id": team_id, "shared": false }), "permission_denied").await;

    // The owner updates filters, layout and sharing.
    let upd = ok(&router, &format!("{VIEW}/UpdateSavedView"), &ta,
        json!({ "id": mine_id, "query": "status=done", "layout": "LIST", "shared": true })).await;
    assert_eq!(upd["query"], "status=done");
    assert_eq!(upd["layout"], "LIST");
    assert_eq!(upd["shared"], true);
    assert_eq!(names(&list(tb.clone()).await), vec!["My bugs", "Urgent"]);

    // Validation and membership.
    fails(&router, &format!("{VIEW}/CreateSavedView"), &ta, json!({ "projectId": pid, "name": "  ", "query": "" }), "invalid_argument").await;
    fails(&router, &format!("{VIEW}/CreateSavedView"), &ta, json!({ "projectId": pid, "name": "x".repeat(81), "query": "" }), "invalid_argument").await;
    fails(&router, &format!("{VIEW}/CreateSavedView"), &ta, json!({ "projectId": pid, "name": "Long", "query": format!("q={}", "a".repeat(2000)) }), "invalid_argument").await;
    fails(&router, &format!("{VIEW}/ListSavedViews"), &token(&outsider), json!({ "projectId": pid }), "permission_denied").await;

    ok(&router, &format!("{VIEW}/DeleteSavedView"), &ta, json!({ "id": mine_id })).await;
    assert_eq!(names(&list(ta.clone()).await), vec!["Urgent"]);
}

async fn task(router: &Router, tok: &str, module: &str, title: &str, extra: Value) -> Value {
    let mut body = json!({ "moduleId": module, "title": title });
    body.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    ok(router, &format!("{TASK}/CreateTask"), tok, body).await
}

fn ids(v: &[&Value]) -> Vec<String> {
    v.iter().map(|t| s(t, "id")).collect()
}

#[tokio::test]
async fn bulk_update_applies_each_field_to_every_task() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let member = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[&member]).await;
    let to = token(&owner);
    let (m1, m2) = (module(&router, &to, &pid).await, module(&router, &to, &pid).await);
    let done = s(named(&statuses(&router, &to, &pid).await, "Done"), "id");
    let a = task(&router, &to, &m1, "A", json!({ "assigneeIds": [owner] })).await;
    let b = task(&router, &to, &m1, "B", json!({})).await;
    let sub = task(&router, &to, &m1, "B.1", json!({ "parentId": b["id"] })).await;
    let c = task(&router, &to, &m2, "C", json!({})).await;

    let resp = ok(&router, &format!("{TASK}/BulkUpdateTasks"), &to, json!({
        "taskIds": ids(&[&a, &b, &a]),           // duplicates collapse
        "statusId": done,
        "priority": "HIGH",
        "addAssigneeIds": [member],
        "removeAssigneeIds": [owner],
        "dueDate": "2026-11-01",
    })).await;
    let tasks = resp["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 2);
    assert!(resp["failed"].as_array().is_none_or(|f| f.is_empty()));
    for t in tasks {
        assert_eq!(s(t, "statusId"), done);
        assert_eq!(t["status"], "DONE");
        assert!(t["completedAt"].is_string());
        assert_eq!(t["priority"], "HIGH");
        assert_eq!(t["assigneeIds"], json!([member]));
        assert_eq!(t["dueDate"], "2026-11-01");
    }

    // Moving: the parent goes to the end of m2 and takes its subtask; a lone
    // subtask whose parent is not moved is refused, the rest still applies.
    let other = task(&router, &to, &m1, "D", json!({})).await;
    let other_sub = task(&router, &to, &m1, "D.1", json!({ "parentId": other["id"] })).await;
    let resp = ok(&router, &format!("{TASK}/BulkUpdateTasks"), &to, json!({
        "taskIds": ids(&[&b, &other_sub]),
        "moduleId": m2,
    })).await;
    let failed = resp["failed"].as_array().unwrap();
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0]["id"], other_sub["id"]);
    let moved = ok(&router, &format!("{TASK}/GetTask"), &to, json!({ "id": b["id"] })).await;
    assert_eq!(s(&moved, "moduleId"), m2);
    assert!(num(&moved, "order") > num(&c, "order"), "appended after C");
    let moved_sub = ok(&router, &format!("{TASK}/GetTask"), &to, json!({ "id": sub["id"] })).await;
    assert_eq!(s(&moved_sub, "moduleId"), m2, "subtask follows its parent");

    // Whole-call refusals: another project, a non-member assignee, a status
    // from elsewhere, nothing at all, too many.
    let other_project = project_with(&router, &owner, &[]).await;
    let om = module(&router, &to, &other_project).await;
    let x = task(&router, &to, &om, "X", json!({})).await;
    let outsider = mk_user(&store).await;
    let foreign_status = s(&statuses(&router, &to, &other_project).await[0], "id");
    let bulk = format!("{TASK}/BulkUpdateTasks");
    fails(&router, &bulk, &to, json!({ "taskIds": ids(&[&a, &x]), "priority": "LOW" }), "invalid_argument").await;
    fails(&router, &bulk, &to, json!({ "taskIds": ids(&[&a]), "addAssigneeIds": [outsider] }), "invalid_argument").await;
    fails(&router, &bulk, &to, json!({ "taskIds": ids(&[&a]), "statusId": foreign_status }), "invalid_argument").await;
    fails(&router, &bulk, &to, json!({ "taskIds": [] }), "invalid_argument").await;
    let many: Vec<String> = (0..201).map(|i| i.to_string()).collect();
    fails(&router, &bulk, &to, json!({ "taskIds": many }), "invalid_argument").await;
    fails(&router, &bulk, &token(&outsider), json!({ "taskIds": ids(&[&a]), "priority": "LOW" }), "permission_denied").await;
    // A refused call changed nothing.
    let a_now = ok(&router, &format!("{TASK}/GetTask"), &to, json!({ "id": a["id"] })).await;
    assert_eq!(a_now["priority"], "HIGH");
}

#[tokio::test]
async fn bulk_delete_takes_subtasks_and_reports_ids() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[]).await;
    let to = token(&owner);
    let m = module(&router, &to, &pid).await;
    let a = task(&router, &to, &m, "A", json!({})).await;
    let a1 = task(&router, &to, &m, "A.1", json!({ "parentId": a["id"] })).await;
    let b = task(&router, &to, &m, "B", json!({})).await;
    let keep = task(&router, &to, &m, "Keep", json!({})).await;

    // The subtask is both selected and cascaded: deleted once, reported once.
    let resp = ok(&router, &format!("{TASK}/BulkDeleteTasks"), &to, json!({ "taskIds": ids(&[&a, &a1, &b]) })).await;
    let mut gone: Vec<String> = resp["deletedIds"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect();
    gone.sort();
    let mut want = ids(&[&a, &a1, &b]);
    want.sort();
    assert_eq!(gone, want);
    let left = ok(&router, &format!("{TASK}/ListTasks"), &to, json!({ "projectId": pid })).await;
    let left: Vec<String> = left["tasks"].as_array().unwrap().iter().map(|t| s(t, "id")).collect();
    assert_eq!(left, vec![s(&keep, "id")]);
}
