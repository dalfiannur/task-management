//! End-to-end workload + working-day calendars over the real Connect routers + Postgres.
//! Skipped unless `DATABASE_URL` is set.

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
const TIME: &str = "/sedjiwa.tasks.time.v1.TimeService";
const WORK: &str = "/sedjiwa.tasks.workload.v1.WorkloadService";

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
        .merge(transport::time_router(store.clone()))
        .merge(transport::workload_router(store.clone()))
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

async fn module(router: &Router, tok: &str, project: &str) -> String {
    s(&ok(router, &format!("{MODULE}/CreateModule"), tok, json!({ "projectId": project, "name": "M" })).await, "id")
}

/// Expect a non-OK reply carrying `code`.
async fn fails(router: &Router, path: &str, tok: &str, body: Value, code: &str) {
    let (st, v) = call(router, path, Some(tok), body).await;
    assert_ne!(st, StatusCode::OK, "{path} should fail: {v}");
    assert_eq!(v["code"], code, "{path}: {v}");
}

fn admin_token(sub: &str) -> String {
    sign_jwt(SECRET, sub, &["*".to_string()], 9_999_999_999).unwrap()
}

/// Task with estimate, assignees and dates; returns its id.
async fn est_task(router: &Router, tok: &str, module: &str, body: Value) -> String {
    let mut b = json!({ "moduleId": module, "title": "T" });
    b.as_object_mut().unwrap().extend(body.as_object().unwrap().clone());
    s(&ok(router, &format!("{TASK}/CreateTask"), tok, b).await, "id")
}

async fn workload(router: &Router, tok: &str, project: Option<&str>) -> Value {
    let mut b = json!({ "today": "2026-10-21", "weeks": 2 });
    if let Some(p) = project {
        b["projectId"] = json!(p);
    }
    ok(router, &format!("{WORK}/GetWorkload"), tok, b).await
}

fn member<'a>(w: &'a Value, user: &str) -> &'a Value {
    w["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["userId"] == user)
        .unwrap_or_else(|| panic!("no row for {user}: {w}"))
}

/// Planned minutes per shown week.
fn planned(m: &Value) -> Vec<i64> {
    m["weeks"].as_array().unwrap().iter().map(|w| num(w, "plannedMinutes")).collect()
}

fn capacity(m: &Value) -> Vec<i64> {
    m["weeks"].as_array().unwrap().iter().map(|w| num(w, "capacityMinutes")).collect()
}

#[tokio::test]
async fn workload_spreads_remaining_effort_over_shared_working_days() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (a, b, outsider) = (mk_user(&store).await, mk_user(&store).await, mk_user(&store).await);
    let (ta, tb) = (token(&a), token(&b));
    let pid = project_with(&router, &a, &[&b]).await;
    let m = module(&router, &ta, &pid).await;

    // 2026-10-21 is a Wednesday: weeks of Oct 19 and Oct 26.
    // Shared: 600 split 300/300, spread Wed Thu Fri | Mon Tue.
    let shared = est_task(&router, &ta, &m, json!({
        "assigneeIds": [a, b], "estimateMinutes": 600, "dueDate": "2026-10-27"
    })).await;
    // Parent whose subtask is estimated: only the subtask counts.
    let parent = est_task(&router, &ta, &m, json!({ "assigneeIds": [a], "estimateMinutes": 1000 })).await;
    est_task(&router, &ta, &m, json!({ "assigneeIds": [a], "estimateMinutes": 120, "parentId": parent })).await;
    // Overdue, and a done task that never counts.
    est_task(&router, &ta, &m, json!({ "assigneeIds": [b], "estimateMinutes": 60, "dueDate": "2026-10-01" })).await;
    est_task(&router, &ta, &m, json!({ "assigneeIds": [a], "estimateMinutes": 60, "dueDate": "2026-10-22", "status": "DONE" })).await;

    let w = workload(&router, &ta, Some(&pid)).await;
    assert_eq!(w["weekStarts"], json!(["2026-10-19", "2026-10-26"]));
    let ra = member(&w, &a);
    assert_eq!(planned(ra), vec![180, 120]);
    assert_eq!(num(ra, "unscheduledMinutes"), 120, "subtask, not the parent's 1000");
    assert_eq!(num(ra, "totalMinutes"), 420);
    assert_eq!(num(ra, "weeklyMinutes"), 2400);
    assert_eq!(capacity(ra), vec![1440, 2400], "this week from Wednesday: 3 of 5 days");
    assert_eq!(ra["tasks"].as_array().unwrap().len(), 2);
    let rb = member(&w, &b);
    assert_eq!(num(rb, "overdueMinutes"), 60);
    assert_eq!(num(rb, "totalMinutes"), 360);

    // Logged time comes off the remaining effort: 600 − 100 = 500 → 250 each.
    ok(&router, &format!("{TIME}/LogTime"), &ta, json!({ "taskId": shared, "minutes": 100, "date": "2026-10-20" })).await;
    let w = workload(&router, &ta, Some(&pid)).await;
    assert_eq!(planned(member(&w, &a)), vec![150, 100]);

    // Project works Mon–Wed: Wed | Mon Tue → 84 | 83 + 83.
    fails(&router, &format!("{WORK}/SetWorkCalendar"), &tb,
        json!({ "scope": "CALENDAR_SCOPE_PROJECT", "id": pid, "workingDays": [1, 2, 3] }), "permission_denied").await;
    let cal = ok(&router, &format!("{WORK}/SetWorkCalendar"), &ta,
        json!({ "scope": "CALENDAR_SCOPE_PROJECT", "id": pid, "workingDays": [3, 1, 2] })).await;
    assert_eq!(cal["workingDays"], json!([1, 2, 3]));
    assert_eq!(cal["canEdit"], true);
    let w = workload(&router, &ta, Some(&pid)).await;
    assert_eq!(planned(member(&w, &a)), vec![84, 166]);

    // b works weekends only: no day shared with the project → b's own days, flagged.
    fails(&router, &format!("{WORK}/SetWorkCalendar"), &ta,
        json!({ "scope": "CALENDAR_SCOPE_USER", "id": b, "workingDays": [6, 7] }), "permission_denied").await;
    let cal = ok(&router, &format!("{WORK}/SetWorkCalendar"), &tb,
        json!({ "scope": "CALENDAR_SCOPE_USER", "id": b, "workingDays": [6, 7], "weeklyMinutes": 600 })).await;
    assert_eq!(num(&cal, "effectiveWeeklyMinutes"), 600);
    let w = workload(&router, &ta, Some(&pid)).await;
    let rb = member(&w, &b);
    assert_eq!(planned(rb), vec![250, 0]);
    assert_eq!(capacity(rb), vec![600, 600]);
    assert_eq!(rb["calendarConflict"], true);
    assert_eq!(member(&w, &a)["calendarConflict"], Value::Null);

    // Clearing goes back to inheriting.
    let cal = ok(&router, &format!("{WORK}/SetWorkCalendar"), &tb,
        json!({ "scope": "CALENDAR_SCOPE_USER", "id": b })).await;
    assert_eq!(cal["workingDays"], Value::Null);
    assert_eq!(cal["effectiveDays"], json!([1, 2, 3, 4, 5]));
    assert_eq!(num(&cal, "effectiveWeeklyMinutes"), 2400);

    // Cross-project view: the caller's projects only.
    let w = workload(&router, &tb, None).await;
    member(&w, &a);
    assert!(w["members"].as_array().unwrap().iter().all(|r| r["userId"] != outsider));

    // Outsiders see nothing of the project.
    fails(&router, &format!("{WORK}/GetWorkload"), &token(&outsider),
        json!({ "projectId": pid }), "permission_denied").await;
    fails(&router, &format!("{WORK}/GetWorkCalendar"), &token(&outsider),
        json!({ "scope": "CALENDAR_SCOPE_PROJECT", "id": pid }), "permission_denied").await;
}

#[tokio::test]
async fn global_calendar_is_admin_only() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let u = mk_user(&store).await;
    let g = json!({ "scope": "CALENDAR_SCOPE_GLOBAL" });
    let cal = ok(&router, &format!("{WORK}/GetWorkCalendar"), &token(&u), g.clone()).await;
    assert_eq!(cal["canEdit"], Value::Null);
    fails(&router, &format!("{WORK}/SetWorkCalendar"), &token(&u),
        json!({ "scope": "CALENDAR_SCOPE_GLOBAL", "workingDays": [1, 2, 3, 4, 5] }), "permission_denied").await;

    let admin = admin_token(&u);
    fails(&router, &format!("{WORK}/SetWorkCalendar"), &admin, g.clone(), "invalid_argument").await;
    fails(&router, &format!("{WORK}/SetWorkCalendar"), &admin,
        json!({ "scope": "CALENDAR_SCOPE_GLOBAL", "workingDays": [8] }), "invalid_argument").await;
    fails(&router, &format!("{WORK}/SetWorkCalendar"), &admin,
        json!({ "scope": "CALENDAR_SCOPE_GLOBAL", "workingDays": [1], "weeklyMinutes": 60 }), "invalid_argument").await;
    // Same as the default, so concurrent tests are unaffected.
    let cal = ok(&router, &format!("{WORK}/SetWorkCalendar"), &admin,
        json!({ "scope": "CALENDAR_SCOPE_GLOBAL", "workingDays": [1, 2, 3, 4, 5] })).await;
    assert_eq!(cal["effectiveDays"], json!([1, 2, 3, 4, 5]));
    assert_eq!(cal["canEdit"], true);
    fails(&router, &format!("{WORK}/GetWorkCalendar"), &admin,
        json!({ "scope": "CALENDAR_SCOPE_USER", "id": "999999999" }), "not_found").await;
}
