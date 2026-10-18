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

#[tokio::test]
async fn workload_rpcs_require_a_token() {
    let Some((router, _store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    for (method, body) in [
        ("GetWorkload", json!({})),
        ("GetWorkCalendar", json!({ "scope": "CALENDAR_SCOPE_GLOBAL" })),
        ("SetWorkCalendar", json!({ "scope": "CALENDAR_SCOPE_GLOBAL", "workingDays": [1] })),
    ] {
        let (st, v) = call(&router, &format!("{WORK}/{method}"), None, body).await;
        assert_ne!(st, StatusCode::OK, "{method} without a token must fail");
        assert_eq!(v["code"], "unauthenticated", "{method} without a token: {v}");
    }
}

#[tokio::test]
async fn workload_and_calendar_input_is_validated() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let u = mk_user(&store).await;
    let tu = token(&u);
    let pid = project_with(&router, &u, &[]).await;
    let (get_wl, get_cal, set_cal) = (
        format!("{WORK}/GetWorkload"),
        format!("{WORK}/GetWorkCalendar"),
        format!("{WORK}/SetWorkCalendar"),
    );

    // GetWorkload.
    for today in ["21-10-2026", "2026-10-21x", "2026-02-30"] {
        fails(&router, &get_wl, &tu, json!({ "projectId": pid, "today": today }), "invalid_argument").await;
    }
    fails(&router, &get_wl, &tu, json!({ "projectId": pid, "weeks": -1 }), "invalid_argument").await;
    let w = ok(&router, &get_wl, &tu, json!({ "projectId": pid, "today": "2026-10-21", "weeks": 50 })).await;
    assert_eq!(w["weekStarts"].as_array().unwrap().len(), 12, "weeks is capped at 12");
    assert_eq!(w["weekStarts"][0], "2026-10-19", "weeks start on the Monday of today's week");
    let w = ok(&router, &get_wl, &tu, json!({ "projectId": pid, "today": "2026-10-21" })).await;
    assert_eq!(w["weekStarts"].as_array().unwrap().len(), 6, "weeks = 0 means 6");
    assert_eq!(w["projects"].as_array().unwrap().len(), 1, "a project filter scopes to that project");
    for bad in ["999999999999", "abc"] {
        fails(&router, &get_wl, &tu, json!({ "projectId": bad }), "not_found").await;
    }

    // Calendars.
    fails(&router, &get_cal, &tu, json!({}), "invalid_argument").await;
    fails(&router, &set_cal, &tu, json!({ "id": u, "workingDays": [1] }), "invalid_argument").await;
    let me = |extra: Value| {
        let mut b = json!({ "scope": "CALENDAR_SCOPE_USER", "id": u });
        b.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        b
    };
    for days in [json!([0]), json!([8]), json!([1, -1])] {
        fails(&router, &set_cal, &tu, me(json!({ "workingDays": days })), "invalid_argument").await;
    }
    fails(&router, &set_cal, &tu, me(json!({ "weeklyMinutes": 10081 })), "invalid_argument").await;
    fails(&router, &set_cal, &tu, me(json!({ "weeklyMinutes": -1 })), "invalid_argument").await;
    let max = ok(&router, &set_cal, &tu, me(json!({ "weeklyMinutes": 10080 }))).await;
    assert_eq!(num(&max, "effectiveWeeklyMinutes"), 10080, "a full week is the most allowed");
    fails(&router, &set_cal, &tu,
        json!({ "scope": "CALENDAR_SCOPE_PROJECT", "id": pid, "workingDays": [1], "weeklyMinutes": 60 }),
        "invalid_argument").await;
    let dup = ok(&router, &set_cal, &tu, me(json!({ "workingDays": [5, 1, 5] }))).await;
    assert_eq!(dup["workingDays"], json!([1, 5]), "days are deduplicated and sorted");
    let read = ok(&router, &get_cal, &tu, json!({ "scope": "CALENDAR_SCOPE_USER", "id": u })).await;
    assert_eq!(read["workingDays"], json!([1, 5]), "a follow-up read returns the saved days");
    // A set is the whole setting (confirmed intended): omitting weekly minutes means the default.
    assert_eq!(read["weeklyMinutes"], Value::Null, "an update without weekly minutes resets them to the default");
    assert_eq!(num(&read, "effectiveWeeklyMinutes"), 2400);

    for bad in ["999999999999", "abc"] {
        fails(&router, &get_cal, &tu, json!({ "scope": "CALENDAR_SCOPE_PROJECT", "id": bad }), "not_found").await;
        fails(&router, &set_cal, &tu, json!({ "scope": "CALENDAR_SCOPE_USER", "id": bad, "workingDays": [1] }), "not_found").await;
    }
    // A project id is not a user, and vice versa.
    fails(&router, &get_cal, &tu, json!({ "scope": "CALENDAR_SCOPE_USER", "id": pid }), "not_found").await;
    fails(&router, &get_cal, &tu, json!({ "scope": "CALENDAR_SCOPE_PROJECT", "id": u }), "not_found").await;
}

#[tokio::test]
async fn workload_places_effort_by_dates_shares_and_status() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let mut us = Vec::new();
    for _ in 0..8 {
        us.push(mk_user(&store).await);
    }
    let [a, b, c, d, e, f, g, h] = <[String; 8]>::try_from(us).unwrap();
    let to = token(&owner);
    let pid = project_with(&router, &owner, &[&a, &b, &c, &d, &e, &f, &g, &h]).await;
    let m = module(&router, &to, &pid).await;

    // today = Wed 2026-10-21, weeks shown: Oct 19 and Oct 26.
    // 7 split over [a, b]: the remainder goes to the first assignee.
    est_task(&router, &to, &m, json!({ "assigneeIds": [a, b], "estimateMinutes": 7 })).await;
    // 29 working days Oct 21 … Nov 30 at 10/day: 3 days, 5 days, the rest later.
    let long = est_task(&router, &to, &m, json!({ "assigneeIds": [c], "estimateMinutes": 290, "dueDate": "2026-11-30" })).await;
    // Saturday to Saturday: no working day in the span → all on the due date.
    est_task(&router, &to, &m, json!({ "assigneeIds": [d], "estimateMinutes": 50, "startDate": "2026-10-24", "dueDate": "2026-10-24" })).await;
    // Wed Thu Fri | Mon: 6 → 2 2 1 | 1 (the remainder to the earliest days).
    est_task(&router, &to, &m, json!({ "assigneeIds": [e], "estimateMinutes": 6, "dueDate": "2026-10-26" })).await;
    // Starts in the future: nothing before its start.
    est_task(&router, &to, &m, json!({ "assigneeIds": [f], "estimateMinutes": 100, "startDate": "2026-10-27", "dueDate": "2026-10-28" })).await;
    // In progress counts like todo.
    est_task(&router, &to, &m, json!({ "assigneeIds": [f], "estimateMinutes": 30, "status": "IN_PROGRESS" })).await;
    // None of these count: unestimated, unassigned, fully logged, cancelled/done.
    est_task(&router, &to, &m, json!({ "assigneeIds": [g] })).await;
    est_task(&router, &to, &m, json!({ "estimateMinutes": 500 })).await;
    let spent = est_task(&router, &to, &m, json!({ "assigneeIds": [g], "estimateMinutes": 30 })).await;
    ok(&router, &format!("{TIME}/LogTime"), &to, json!({ "taskId": spent, "minutes": 45 })).await;
    est_task(&router, &to, &m, json!({ "assigneeIds": [g], "estimateMinutes": 30, "status": "DONE" })).await;
    // Due today is this week, not overdue.
    est_task(&router, &to, &m, json!({ "assigneeIds": [h], "estimateMinutes": 40, "dueDate": "2026-10-21" })).await;

    let w = workload(&router, &to, Some(&pid)).await;
    let (ra, rb) = (member(&w, &a), member(&w, &b));
    assert_eq!((num(ra, "unscheduledMinutes"), num(rb, "unscheduledMinutes")), (4, 3), "7 over two: 4 + 3");
    assert_eq!(ra["tasks"][0]["bucket"], "WORKLOAD_BUCKET_UNSCHEDULED");

    let rc = member(&w, &c);
    assert_eq!(planned(rc), vec![30, 50], "10 a day over the shown weeks");
    assert_eq!(num(rc, "laterMinutes"), 210, "the rest of the span is later");
    assert_eq!(num(rc, "totalMinutes"), 290);
    assert_eq!(rc["tasks"][0]["bucket"], "WORKLOAD_BUCKET_SCHEDULED");
    assert_eq!(rc["tasks"][0]["taskId"], long.as_str());
    assert_eq!(num(&rc["tasks"][0], "remainingMinutes"), 290);

    assert_eq!(planned(member(&w, &d)), vec![50, 0], "a span with no working day lands on its due date");
    assert_eq!(planned(member(&w, &e)), vec![5, 1], "earliest days take the remainder");
    let rf = member(&w, &f);
    assert_eq!(planned(rf), vec![0, 100], "nothing is planned before the start date");
    assert_eq!(num(rf, "unscheduledMinutes"), 30, "in-progress tasks count");

    let rg = member(&w, &g);
    assert_eq!(num(rg, "totalMinutes"), 0, "unestimated, over-logged and done tasks add nothing");
    assert!(rg["tasks"].as_array().is_none_or(|t| t.is_empty()), "and are not listed: {rg}");
    assert_eq!(capacity(rg), vec![1440, 2400], "members with nothing planned still show capacity");

    let rh = member(&w, &h);
    assert_eq!(planned(rh), vec![40, 0], "due today is planned for today");
    assert_eq!(num(rh, "overdueMinutes"), 0);

    // The project owner has nothing assigned but is still a row.
    assert_eq!(num(member(&w, &owner), "totalMinutes"), 0);
}

#[tokio::test]
async fn calendars_inherit_and_shape_capacity() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, mate, admin) = (mk_user(&store).await, mk_user(&store).await, mk_user(&store).await);
    let (to, tm, ta) = (token(&owner), token(&mate), admin_token(&admin));
    let pid = project_with(&router, &owner, &[&mate]).await;
    let m = module(&router, &to, &pid).await;
    let (get_cal, set_cal) = (format!("{WORK}/GetWorkCalendar"), format!("{WORK}/SetWorkCalendar"));
    let proj = json!({ "scope": "CALENDAR_SCOPE_PROJECT", "id": pid });

    // A fresh project inherits the global days; members read, only the owner edits.
    let cal = ok(&router, &get_cal, &tm, proj.clone()).await;
    assert_eq!(cal["workingDays"], Value::Null, "nothing of its own");
    assert_eq!(cal["effectiveDays"], json!([1, 2, 3, 4, 5]), "inherits Mon–Fri");
    assert_eq!(cal["canEdit"], Value::Null, "a plain member cannot edit");
    assert_eq!(ok(&router, &get_cal, &to, proj.clone()).await["canEdit"], true, "the owner can");
    // An admin who is not a member can set it.
    let cal = ok(&router, &set_cal, &ta, json!({ "scope": "CALENDAR_SCOPE_PROJECT", "id": pid, "workingDays": [1, 3, 5] })).await;
    assert_eq!(cal["workingDays"], json!([1, 3, 5]));
    assert_eq!(ok(&router, &get_cal, &tm, proj.clone()).await["effectiveDays"], json!([1, 3, 5]), "members read the saved days back");
    // The admin may set anyone's own calendar too.
    let cal = ok(&router, &set_cal, &ta, json!({ "scope": "CALENDAR_SCOPE_USER", "id": mate, "workingDays": [1, 2, 3, 5], "weeklyMinutes": 1200 })).await;
    assert_eq!(cal["canEdit"], true);

    // mate: Mon Tue Wed Fri at 1200/week → from Wed, 2 of 4 days are left: 600.
    // Shared with the project (Mon Wed Fri): Wed Fri | Mon Wed Fri.
    est_task(&router, &to, &m, json!({ "assigneeIds": [mate], "estimateMinutes": 50, "dueDate": "2026-10-30" })).await;
    let w = workload(&router, &to, Some(&pid)).await;
    let r = member(&w, &mate);
    assert_eq!(capacity(r), vec![600, 1200], "capacity counts the user's working days left from today");
    assert_eq!(planned(r), vec![20, 30], "spread over days both the user and the project work");
    assert_eq!(r["workingDays"], json!([1, 2, 3, 5]));
    assert_eq!(num(r, "weeklyMinutes"), 1200);
    assert_eq!(r["calendarConflict"], Value::Null);

    // Zero weekly hours is allowed and means no capacity.
    ok(&router, &set_cal, &tm, json!({ "scope": "CALENDAR_SCOPE_USER", "id": mate, "weeklyMinutes": 0 })).await;
    let w = workload(&router, &to, Some(&pid)).await;
    assert_eq!(capacity(member(&w, &mate)), vec![0, 0]);

    // Clearing the project's days goes back to the global ones.
    let cal = ok(&router, &set_cal, &to, json!({ "scope": "CALENDAR_SCOPE_PROJECT", "id": pid })).await;
    assert_eq!(cal["workingDays"], Value::Null);
    assert_eq!(cal["effectiveDays"], json!([1, 2, 3, 4, 5]));

    // Deleting the project removes its calendar row.
    let project_pid: i64 = pid.parse().unwrap();
    ok(&router, &set_cal, &to, json!({ "scope": "CALENDAR_SCOPE_PROJECT", "id": pid, "workingDays": [2] })).await;
    ok(&router, &format!("{PROJECT}/DeleteProject"), &to, json!({ "id": pid })).await;
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM cmp_workcalendar WHERE pid = $1")
        .bind(project_pid)
        .fetch_one(store.pool())
        .await
        .unwrap();
    assert_eq!(left, 0, "a deleted project's calendar goes with it");
}

#[tokio::test]
async fn cross_project_workload_scope_follows_membership() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (a, b, c, admin) = (mk_user(&store).await, mk_user(&store).await, mk_user(&store).await, mk_user(&store).await);
    let (ta, tb) = (token(&a), token(&b));
    // a: P1 with b. c: P2 with b. b sees both; a sees only P1.
    let p1 = project_with(&router, &a, &[&b]).await;
    let p2 = project_with(&router, &c, &[&b]).await;
    let m1 = module(&router, &ta, &p1).await;
    let m2 = module(&router, &token(&c), &p2).await;
    est_task(&router, &ta, &m1, json!({ "assigneeIds": [b], "estimateMinutes": 60 })).await;
    est_task(&router, &token(&c), &m2, json!({ "assigneeIds": [b], "estimateMinutes": 90 })).await;

    let ids = |w: &Value| -> Vec<String> { w["projects"].as_array().unwrap().iter().map(|p| s(p, "id")).collect() };
    let wb = workload(&router, &tb, None).await;
    assert!(ids(&wb).contains(&p1) && ids(&wb).contains(&p2), "b's view covers both of b's projects");
    assert_eq!(num(member(&wb, &b), "unscheduledMinutes"), 150, "b's effort summed across projects");
    member(&wb, &c);

    let wa = workload(&router, &ta, None).await;
    assert!(!ids(&wa).contains(&p2), "a does not see a project a is not in");
    assert_eq!(num(member(&wa, &b), "unscheduledMinutes"), 60, "a sees only b's effort in a's projects");
    assert!(wa["members"].as_array().unwrap().iter().all(|r| r["userId"] != c.as_str()), "nor that project's people");
    fails(&router, &format!("{WORK}/GetWorkload"), &ta, json!({ "projectId": p2 }), "permission_denied").await;

    // Admin, a member of neither: both projects, and b's full effort.
    let w = workload(&router, &admin_token(&admin), None).await;
    assert!(ids(&w).contains(&p1) && ids(&w).contains(&p2), "admin sees every project");
    assert_eq!(num(member(&w, &b), "unscheduledMinutes"), 150);
    let w = workload(&router, &admin_token(&admin), Some(&p2)).await;
    assert_eq!(num(member(&w, &b), "unscheduledMinutes"), 90, "admin may filter to any project");

    // Someone still assigned after leaving the project keeps their row.
    ok(&router, &format!("{PROJECT}/RemoveProjectMember"), &ta, json!({ "projectId": p1, "userId": b })).await;
    let w = workload(&router, &ta, Some(&p1)).await;
    assert_eq!(num(member(&w, &b), "unscheduledMinutes"), 60, "assigned work stays visible");
}
