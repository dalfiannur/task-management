//! End-to-end per-project task statuses over the real Connect routers +
//! Postgres. Skipped unless `DATABASE_URL` is set.

use std::sync::Arc;

use auth::{sign_jwt, verify_jwt};
use axum::body::{to_bytes, Body};
use axum::extract::Request;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::StatusCode;
use axum::middleware::{from_fn, Next};
use axum::response::Response;
use axum::Router;
use domain::task::{TaskAudit, TaskInfo, TaskModuleRef};
use domain::user::{UserPassword, UserPhone, UserProfile, UserStatusComponent};
use persistence::Store;
use serde_json::{json, Value};
use tower::ServiceExt;

const SECRET: &str = "test-secret";
const PROJECT: &str = "/sedjiwa.tasks.project.v1.ProjectService";
const MODULE: &str = "/sedjiwa.tasks.work.v1.ModuleService";
const TASK: &str = "/sedjiwa.tasks.work.v1.TaskService";
const STATUS: &str = "/sedjiwa.tasks.work.v1.TaskStatusService";

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

#[tokio::test]
async fn custom_statuses_drive_the_category() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let member = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[&member]).await;
    let tm = token(&member);

    // A new project starts with the four defaults, in order.
    let list = statuses(&router, &tm, &pid).await;
    let names: Vec<&str> = list.iter().map(|s| s["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec!["To Do", "In Progress", "Done", "Cancelled"]);
    let (todo, done) = (s(named(&list, "To Do"), "id"), s(named(&list, "Done"), "id"));

    // A task starts on the first todo status.
    let m = module(&router, &token(&owner), &pid).await;
    let t = ok(&router, &format!("{TASK}/CreateTask"), &tm, json!({ "moduleId": m, "title": "T" })).await;
    assert_eq!(s(&t, "statusId"), todo);
    assert_eq!(t["statusName"], "To Do");
    let tid = s(&t, "id");

    // A member adds "Review" (in progress); it lands last.
    let review = ok(&router, &format!("{STATUS}/CreateTaskStatus"), &tm,
        json!({ "projectId": pid, "name": " Review ", "color": "#a855f7", "category": "IN_PROGRESS" })).await;
    assert_eq!(review["name"], "Review");
    assert_eq!(num(&review, "order"), 4);
    let rid = s(&review, "id");

    // Moving the task there sets its category, not completedAt.
    let t = ok(&router, &format!("{TASK}/UpdateTask"), &tm, json!({ "id": tid, "statusId": rid })).await;
    assert_eq!(t["status"], "IN_PROGRESS");
    assert_eq!(t["statusName"], "Review");
    assert_eq!(t["statusColor"], "#a855f7");
    assert!(t["completedAt"].is_null());

    // Re-categorising the status carries its tasks along, completedAt included.
    ok(&router, &format!("{STATUS}/UpdateTaskStatus"), &tm, json!({ "id": rid, "category": "DONE" })).await;
    let t = ok(&router, &format!("{TASK}/GetTask"), &tm, json!({ "id": tid })).await;
    assert_eq!(t["status"], "DONE");
    assert!(t["completedAt"].is_string(), "entering done stamps completedAt");
    ok(&router, &format!("{STATUS}/UpdateTaskStatus"), &tm, json!({ "id": rid, "category": "IN_PROGRESS" })).await;
    let t = ok(&router, &format!("{TASK}/GetTask"), &tm, json!({ "id": tid })).await;
    assert_eq!(t["status"], "IN_PROGRESS");
    assert_eq!(s(&t, "statusId"), rid, "the task stays on its status");
    assert!(t["completedAt"].is_null(), "leaving done clears completedAt");

    // A bare category keeps the status when already in it, else takes the first.
    let t = ok(&router, &format!("{TASK}/UpdateTask"), &tm, json!({ "id": tid, "status": "IN_PROGRESS" })).await;
    assert_eq!(s(&t, "statusId"), rid);
    let t = ok(&router, &format!("{TASK}/UpdateTask"), &tm, json!({ "id": tid, "status": "DONE" })).await;
    assert_eq!(s(&t, "statusId"), done);
    assert!(t["completedAt"].is_string());

    // Reorder: every status, once.
    let ids: Vec<String> = statuses(&router, &tm, &pid).await.iter().rev().map(|v| s(v, "id")).collect();
    let re = ok(&router, &format!("{STATUS}/ReorderTaskStatuses"), &tm, json!({ "projectId": pid, "statusIds": ids })).await;
    assert_eq!(re["statuses"][0]["name"], "Review");
    fails(&router, &format!("{STATUS}/ReorderTaskStatuses"), &tm,
        json!({ "projectId": pid, "statusIds": [ids[0]] }), "invalid_argument").await;
}

#[tokio::test]
async fn status_rules_are_enforced() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let outsider = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[]).await;
    let other = project_with(&router, &owner, &[]).await;
    let to = token(&owner);
    let list = statuses(&router, &to, &pid).await;
    let (todo, doing, done, cancelled) = (
        s(named(&list, "To Do"), "id"),
        s(named(&list, "In Progress"), "id"),
        s(named(&list, "Done"), "id"),
        s(named(&list, "Cancelled"), "id"),
    );
    let create = format!("{STATUS}/CreateTaskStatus");

    // Member-gated.
    fails(&router, &format!("{STATUS}/ListTaskStatuses"), &token(&outsider), json!({ "projectId": pid }), "permission_denied").await;
    // Name, color, category, uniqueness.
    fails(&router, &create, &to, json!({ "projectId": pid, "name": " ", "color": "#000000", "category": "TODO" }), "invalid_argument").await;
    fails(&router, &create, &to, json!({ "projectId": pid, "name": "QA", "color": "red", "category": "TODO" }), "invalid_argument").await;
    fails(&router, &create, &to, json!({ "projectId": pid, "name": "QA", "color": "#000000" }), "invalid_argument").await;
    fails(&router, &create, &to, json!({ "projectId": pid, "name": "done", "color": "#000000", "category": "DONE" }), "already_exists").await;

    // The last todo / done status cannot go, by delete or by re-categorising.
    fails(&router, &format!("{STATUS}/DeleteTaskStatus"), &to, json!({ "id": todo }), "failed_precondition").await;
    fails(&router, &format!("{STATUS}/UpdateTaskStatus"), &to, json!({ "id": done, "category": "CANCELLED" }), "failed_precondition").await;
    // Cancelled is optional.
    ok(&router, &format!("{STATUS}/DeleteTaskStatus"), &to, json!({ "id": cancelled })).await;

    // A status from another project is refused on a task.
    let m = module(&router, &to, &pid).await;
    let foreign = s(&statuses(&router, &to, &other).await[0], "id");
    fails(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m, "title": "T", "statusId": foreign }), "invalid_argument").await;

    // A status with tasks needs a replacement; its tasks then move, category and all.
    let a = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m, "title": "A", "statusId": doing })).await;
    let b = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m, "title": "B", "status": "IN_PROGRESS" })).await;
    assert_eq!(s(&b, "statusId"), doing);
    fails(&router, &format!("{STATUS}/DeleteTaskStatus"), &to, json!({ "id": doing }), "failed_precondition").await;
    fails(&router, &format!("{STATUS}/DeleteTaskStatus"), &to, json!({ "id": doing, "replacementId": doing }), "invalid_argument").await;
    ok(&router, &format!("{STATUS}/DeleteTaskStatus"), &to, json!({ "id": doing, "replacementId": done })).await;
    for t in [&a, &b] {
        let got = ok(&router, &format!("{TASK}/GetTask"), &to, json!({ "id": t["id"] })).await;
        assert_eq!(s(&got, "statusId"), done);
        assert_eq!(got["status"], "DONE");
        assert!(got["completedAt"].is_string());
    }

    // With no in-progress status left, that category cannot be asked for.
    fails(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m, "title": "C", "status": "IN_PROGRESS" }), "invalid_argument").await;
}

#[tokio::test]
async fn tasks_without_a_status_fall_back_to_their_category() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);
    let pid = project_with(&router, &owner, &[]).await;
    let m = module(&router, &to, &pid).await;
    // The seed/fixture path writes no status pointer.
    let raw = store
        .create((
            TaskInfo {
                title: "Raw".into(),
                description: String::new(),
                status: "in_progress".into(),
                priority: "none".into(),
                start_date: None,
                due_date: None,
                sort_order: 0,
            },
            TaskModuleRef { module_id: m.clone() },
            TaskAudit {
                created_at: "2026-01-01T00:00:00Z".into(),
                updated_at: "2026-01-01T00:00:00Z".into(),
                completed_at: None,
                created_by: owner.clone(),
            },
        ))
        .await
        .unwrap();
    let got = ok(&router, &format!("{TASK}/GetTask"), &to, json!({ "id": raw.to_string() })).await;
    assert_eq!(got["statusName"], "In Progress");

    // A status that only claims it by fallback still guards its delete.
    let doing = s(named(&statuses(&router, &to, &pid).await, "In Progress"), "id");
    fails(&router, &format!("{STATUS}/DeleteTaskStatus"), &to, json!({ "id": doing }), "failed_precondition").await;
}

#[tokio::test]
async fn existing_projects_get_the_defaults_on_connect() {
    let Some((_router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    // A project written before custom statuses existed (or by a fixture).
    let project = store
        .create((domain::project::ProjectName { value: format!("Old{}", uniq()) },))
        .await
        .unwrap()
        .to_string();
    let count = || async {
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM cmp_taskstatusdef WHERE project_id = $1")
            .bind(&project)
            .fetch_one(store.pool())
            .await
            .unwrap()
    };
    assert_eq!(count().await, 0);
    Store::connect(&std::env::var("DATABASE_URL").unwrap()).await.unwrap();
    assert_eq!(count().await, 4);
    // Idempotent: connecting again adds nothing.
    Store::connect(&std::env::var("DATABASE_URL").unwrap()).await.unwrap();
    assert_eq!(count().await, 4);
}
