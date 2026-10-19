//! End-to-end time tracking over the real Connect routers + Postgres.
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
use base64::Engine;
use calamine::{Data, DataType, Reader, Xlsx};
use domain::user::{UserPassword, UserPhone, UserProfile, UserStatusComponent};
use persistence::Store;
use serde_json::{json, Value};
use tower::ServiceExt;

const SECRET: &str = "test-secret";
const PROJECT: &str = "/sedjiwa.tasks.project.v1.ProjectService";
const MODULE: &str = "/sedjiwa.tasks.work.v1.ModuleService";
const TASK: &str = "/sedjiwa.tasks.work.v1.TaskService";
const TIME: &str = "/sedjiwa.tasks.time.v1.TimeService";
const REPORT: &str = "/sedjiwa.tasks.reports.v1.ReportService";
const ACTIVITY: &str = "/sedjiwa.tasks.activity.v1.ActivityService";

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
        .merge(transport::report_router(store.clone()))
        .merge(transport::activity_router(store.clone()))
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


async fn task(router: &Router, tok: &str, module: &str, title: &str) -> String {
    s(&ok(router, &format!("{TASK}/CreateTask"), tok, json!({ "moduleId": module, "title": title })).await, "id")
}

async fn get(router: &Router, tok: &str, id: &str) -> Value {
    ok(router, &format!("{TASK}/GetTask"), tok, json!({ "id": id })).await
}

fn today() -> String {
    time::OffsetDateTime::now_utc().date().to_string()
}

#[tokio::test]
async fn one_timer_runs_per_user_and_stopping_records_minutes() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);
    let pid = project_with(&router, &owner, &[]).await;
    let m = module(&router, &to, &pid).await;
    let (a, b) = (task(&router, &to, &m, "A").await, task(&router, &to, &m, "B").await);

    let running = ok(&router, &format!("{TIME}/GetRunningTimer"), &to, json!({})).await;
    assert!(running["entry"].is_null());

    let first = ok(&router, &format!("{TIME}/StartTimer"), &to, json!({ "taskId": a, "date": "2026-10-01" })).await;
    assert_eq!(first["running"], true);
    assert_eq!(first["date"], "2026-10-01");
    assert!(first["startedAt"].is_string());
    assert_eq!(first["taskTitle"], "A");
    let running = ok(&router, &format!("{TIME}/GetRunningTimer"), &to, json!({})).await;
    assert_eq!(running["entry"]["id"], first["id"]);
    // A running timer is not logged time yet.
    assert_eq!(num(&get(&router, &to, &a).await, "loggedMinutes"), 0);

    // Starting another stops the first, at a minute at least.
    let second = ok(&router, &format!("{TIME}/StartTimer"), &to, json!({ "taskId": b })).await;
    assert_eq!(second["date"], today(), "date defaults to today");
    let list = ok(&router, &format!("{TIME}/ListTimeEntries"), &to, json!({ "taskId": a })).await;
    let e = &list["entries"][0];
    assert!(e["running"].is_null() || e["running"] == false);
    assert_eq!(num(e, "minutes"), 1);
    assert!(e["endedAt"].is_string());
    assert_eq!(num(&get(&router, &to, &a).await, "loggedMinutes"), 1);

    let stopped = ok(&router, &format!("{TIME}/StopTimer"), &to, json!({})).await;
    assert_eq!(stopped["entry"]["id"], second["id"]);
    let again = ok(&router, &format!("{TIME}/StopTimer"), &to, json!({})).await;
    assert!(again["entry"].is_null(), "nothing left running");
    assert_eq!(num(&get(&router, &to, &b).await, "loggedMinutes"), 1);
}

#[tokio::test]
async fn logged_time_is_member_visible_and_author_owned() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let member = mk_user(&store).await;
    let outsider = mk_user(&store).await;
    let (to, tm) = (token(&owner), token(&member));
    let pid = project_with(&router, &owner, &[&member]).await;
    let m = module(&router, &to, &pid).await;
    let t = task(&router, &to, &m, "T").await;
    let log = format!("{TIME}/LogTime");

    let e = ok(&router, &log, &tm, json!({ "taskId": t, "minutes": 90, "date": "2026-10-02", "note": " design review " })).await;
    assert_eq!(num(&e, "minutes"), 90);
    assert_eq!(e["note"], "design review");
    assert!(e["startedAt"].is_null(), "hand-logged entries have no timer bounds");
    ok(&router, &log, &to, json!({ "taskId": t, "minutes": 30 })).await;
    assert_eq!(num(&get(&router, &to, &t).await, "loggedMinutes"), 120);

    // Bad input and non-members.
    fails(&router, &log, &tm, json!({ "taskId": t, "minutes": 0 }), "invalid_argument").await;
    fails(&router, &log, &tm, json!({ "taskId": t, "minutes": 1441 }), "invalid_argument").await;
    fails(&router, &log, &tm, json!({ "taskId": t, "minutes": 5, "date": "2026-02-30" }), "invalid_argument").await;
    fails(&router, &log, &token(&outsider), json!({ "taskId": t, "minutes": 5 }), "permission_denied").await;
    fails(&router, &format!("{TIME}/ListTimeEntries"), &token(&outsider), json!({ "taskId": t }), "permission_denied").await;
    fails(&router, &format!("{TIME}/ListTimeEntries"), &tm, json!({}), "invalid_argument").await;

    // Everyone in the project sees both entries; only the author edits.
    let list = ok(&router, &format!("{TIME}/ListTimeEntries"), &to, json!({ "projectId": pid })).await;
    assert_eq!(list["entries"].as_array().unwrap().len(), 2);
    let id = s(&e, "id");
    fails(&router, &format!("{TIME}/UpdateTimeEntry"), &to, json!({ "id": id, "minutes": 10 }), "permission_denied").await;
    fails(&router, &format!("{TIME}/DeleteTimeEntry"), &to, json!({ "id": id }), "permission_denied").await;
    let upd = ok(&router, &format!("{TIME}/UpdateTimeEntry"), &tm, json!({ "id": id, "minutes": 45, "note": "shorter" })).await;
    assert_eq!(num(&upd, "minutes"), 45);
    assert_eq!(upd["note"], "shorter");
    assert_eq!(num(&get(&router, &to, &t).await, "loggedMinutes"), 75);

    // A running timer takes a note but not new minutes.
    let run = ok(&router, &format!("{TIME}/StartTimer"), &tm, json!({ "taskId": t })).await;
    fails(&router, &format!("{TIME}/UpdateTimeEntry"), &tm, json!({ "id": run["id"], "minutes": 5 }), "failed_precondition").await;
    ok(&router, &format!("{TIME}/UpdateTimeEntry"), &tm, json!({ "id": run["id"], "note": "pairing" })).await;
    ok(&router, &format!("{TIME}/StopTimer"), &tm, json!({})).await;

    ok(&router, &format!("{TIME}/DeleteTimeEntry"), &tm, json!({ "id": id })).await;
    assert_eq!(num(&get(&router, &to, &t).await, "loggedMinutes"), 31);

    // A user's entries across projects: only where the caller is a member.
    let other = project_with(&router, &outsider, &[&member]).await;
    let om = module(&router, &token(&outsider), &other).await;
    let ot = task(&router, &token(&outsider), &om, "Elsewhere").await;
    ok(&router, &log, &tm, json!({ "taskId": ot, "minutes": 15 })).await;
    let mine = ok(&router, &format!("{TIME}/ListTimeEntries"), &tm, json!({ "userId": member })).await;
    // The stopped timer here and the entry elsewhere (the first was deleted).
    assert_eq!(mine["entries"].as_array().unwrap().len(), 2, "the member sees all their own");
    let seen = ok(&router, &format!("{TIME}/ListTimeEntries"), &to, json!({ "userId": member })).await;
    let projects: Vec<String> = seen["entries"].as_array().unwrap().iter().map(|e| s(e, "projectId")).collect();
    assert!(projects.iter().all(|p| *p == pid), "the owner sees only their project's entries");
}

#[tokio::test]
async fn period_report_counts_logged_time_and_exports_a_timesheet() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let member = mk_user(&store).await;
    let (to, tm) = (token(&owner), token(&member));
    let pid = project_with(&router, &owner, &[&member]).await;
    let m = module(&router, &to, &pid).await;
    let t = task(&router, &to, &m, "Billable").await;
    let log = format!("{TIME}/LogTime");
    ok(&router, &log, &tm, json!({ "taskId": t, "minutes": 90, "date": "2026-09-08", "note": "build" })).await;
    ok(&router, &log, &to, json!({ "taskId": t, "minutes": 30, "date": "2026-09-09" })).await;
    // Outside the window, and in the comparison window.
    ok(&router, &log, &tm, json!({ "taskId": t, "minutes": 60, "date": "2026-09-14" })).await;
    ok(&router, &log, &tm, json!({ "taskId": t, "minutes": 20, "date": "2026-08-31" })).await;

    let body = json!({
        "periodStart": "2026-09-07T00:00:00Z", "periodEnd": "2026-09-14T00:00:00Z",
        "prevStart": "2026-08-31T00:00:00Z", "prevEnd": "2026-09-07T00:00:00Z",
        "periodStartDate": "2026-09-07", "periodEndDate": "2026-09-14",
        "prevStartDate": "2026-08-31", "prevEndDate": "2026-09-07",
    });
    // The owner's view only (a fresh project, so other runs don't leak in).
    let r = ok(&router, &format!("{REPORT}/GetPeriodReport"), &to, body.clone()).await;
    let proj = r["perProject"].as_array().unwrap().iter().find(|p| s(p, "projectId") == pid).unwrap();
    assert_eq!(num(proj, "loggedMinutes"), 120);
    let row = |u: &str| r["perMember"].as_array().unwrap().iter().find(|m| s(m, "userId") == u).cloned();
    assert_eq!(num(&row(&member).unwrap(), "loggedMinutes"), 90);
    assert_eq!(num(&row(&owner).unwrap(), "loggedMinutes"), 30, "a member with only logged time is listed");
    assert!(num(&r["totals"], "loggedMinutes") >= 120);
    assert!(num(&r["prevTotals"], "loggedMinutes") >= 20);
    assert!(r["timesheet"].as_array().is_none_or(|t| t.is_empty()), "only the export carries the timesheet");

    let x = ok(&router, &format!("{REPORT}/ExportPeriodReportXlsx"), &to,
        json!({ "report": body, "label": "w", "granularity": "weekly" })).await;
    let bytes = base64::engine::general_purpose::STANDARD.decode(x["xlsx"].as_str().unwrap()).unwrap();
    let mut wb: Xlsx<_> = calamine::open_workbook_from_rs(std::io::Cursor::new(bytes)).unwrap();
    let sheet = wb.worksheet_range("Timesheet").unwrap();
    let rows: Vec<Vec<Data>> = sheet.rows().map(|r| r.to_vec()).collect();
    let ours: Vec<&Vec<Data>> = rows.iter().filter(|r| r.get(3) == Some(&Data::String("#1 Billable".into()))).collect();
    assert_eq!(ours.len(), 2, "both in-window entries, and only those");
    assert_eq!(ours[0][4], Data::Float(1.5), "hours, oldest first");
    assert_eq!(ours[0][5], Data::String("build".into()));
    assert_eq!(ours[1][4], Data::Float(0.5));
    let header: Vec<String> = rows[0].iter().map(|c| c.to_string()).collect();
    assert_eq!(header, ["Date", "Member", "Project", "Task", "Hours", "Note"], "timesheet columns");
    let last = rows.last().unwrap();
    assert!(last[0].to_string().to_lowercase().contains("total"), "a total row closes the sheet: {last:?}");
    let sum: f64 = rows[1..rows.len() - 1].iter().filter_map(|r| r[4].get_float()).sum();
    assert!((last[4].get_float().unwrap() - sum).abs() < 1e-6, "the total is the sum of the hours");
}

fn admin_token(sub: &str) -> String {
    sign_jwt(SECRET, sub, &["*".to_string()], 9_999_999_999).unwrap()
}

/// Seed a running timer that started `secs_ago` seconds ago, bypassing
/// StartTimer so the elapsed time is under the test's control.
async fn seed_running(store: &Store, task: &str, project: &str, user: &str, secs_ago: i64) {
    use time::format_description::well_known::Rfc3339;
    let started = (time::OffsetDateTime::now_utc() - time::Duration::seconds(secs_ago))
        .format(&Rfc3339)
        .unwrap();
    store
        .create((domain::time::TimeEntryInfo {
            task_id: task.into(),
            project_id: project.into(),
            user_id: user.into(),
            work_date: today(),
            started_at: Some(started.clone()),
            ended_at: None,
            running: true,
            minutes: 0,
            note: String::new(),
            created_at: started,
        },))
        .await
        .unwrap();
}

#[tokio::test]
async fn time_rpcs_require_a_token() {
    let Some((router, _store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    for (method, body) in [
        ("StartTimer", json!({ "taskId": "1" })),
        ("StopTimer", json!({})),
        ("GetRunningTimer", json!({})),
        ("LogTime", json!({ "taskId": "1", "minutes": 5 })),
        ("ListTimeEntries", json!({ "taskId": "1" })),
        ("UpdateTimeEntry", json!({ "id": "1", "note": "x" })),
        ("DeleteTimeEntry", json!({ "id": "1" })),
    ] {
        let (st, v) = call(&router, &format!("{TIME}/{method}"), None, body).await;
        assert_ne!(st, StatusCode::OK, "{method} without a token must fail");
        assert_eq!(v["code"], "unauthenticated", "{method} without a token: {v}");
    }
}

#[tokio::test]
async fn stopped_timer_minutes_are_rounded_and_clamped_to_a_day() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);
    let pid = project_with(&router, &owner, &[]).await;
    let m = module(&router, &to, &pid).await;
    let t = task(&router, &to, &m, "Clock").await;
    let stop = format!("{TIME}/StopTimer");

    // (seconds running, minutes recorded): nearest minute, never 0, never > 1440.
    for (secs, want) in [(5, 1), (150, 3), (149 * 60 + 20, 149), (30 * 3600, 1440)] {
        seed_running(&store, &t, &pid, &owner, secs).await;
        let running = ok(&router, &format!("{TIME}/GetRunningTimer"), &to, json!({})).await;
        assert_eq!(running["entry"]["running"], true, "seeded timer is the running one");
        let e = ok(&router, &stop, &to, json!({})).await;
        assert_eq!(num(&e["entry"], "minutes"), want, "a timer that ran {secs}s records {want}m");
        assert!(e["entry"]["endedAt"].is_string(), "stopping sets ended_at");
    }
    assert_eq!(num(&get(&router, &to, &t).await, "loggedMinutes"), 1 + 3 + 149 + 1440, "every stopped timer counts");
}

#[tokio::test]
async fn time_entry_validation_and_unknown_ids() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);
    let pid = project_with(&router, &owner, &[]).await;
    let m = module(&router, &to, &pid).await;
    let t = task(&router, &to, &m, "V").await;
    let (log, start, list, upd, del) = (
        format!("{TIME}/LogTime"),
        format!("{TIME}/StartTimer"),
        format!("{TIME}/ListTimeEntries"),
        format!("{TIME}/UpdateTimeEntry"),
        format!("{TIME}/DeleteTimeEntry"),
    );

    // Unknown / malformed task ids are not_found, never internal.
    for bad in ["999999999999", "abc", ""] {
        fails(&router, &log, &to, json!({ "taskId": bad, "minutes": 5 }), "not_found").await;
        fails(&router, &start, &to, json!({ "taskId": bad }), "not_found").await;
    }
    fails(&router, &list, &to, json!({ "taskId": "999999999999" }), "not_found").await;
    fails(&router, &upd, &to, json!({ "id": "999999999999", "note": "x" }), "not_found").await;
    fails(&router, &del, &to, json!({ "id": "abc" }), "not_found").await;

    // Bounds and formats.
    fails(&router, &log, &to, json!({ "taskId": t, "minutes": -5 }), "invalid_argument").await;
    ok(&router, &log, &to, json!({ "taskId": t, "minutes": 1440, "date": "2028-02-29" })).await;
    fails(&router, &log, &to, json!({ "taskId": t, "minutes": 5, "date": "2027-02-29" }), "invalid_argument").await;
    fails(&router, &log, &to, json!({ "taskId": t, "minutes": 5, "date": "2026-10-1" }), "invalid_argument").await;
    fails(&router, &log, &to, json!({ "taskId": t, "minutes": 5, "note": "n".repeat(501) }), "invalid_argument").await;
    ok(&router, &log, &to, json!({ "taskId": t, "minutes": 5, "note": "é".repeat(500) })).await;
    fails(&router, &start, &to, json!({ "taskId": t, "date": "tomorrow" }), "invalid_argument").await;
    let nothing = ok(&router, &format!("{TIME}/GetRunningTimer"), &to, json!({})).await;
    assert!(nothing["entry"].is_null(), "a rejected StartTimer starts nothing");
    fails(&router, &list, &to, json!({ "taskId": t, "from": "01-10-2026" }), "invalid_argument").await;

    let e = ok(&router, &log, &to, json!({ "taskId": t, "minutes": 30, "date": "2026-10-05" })).await;
    let id = s(&e, "id");
    fails(&router, &upd, &to, json!({ "id": id, "minutes": 0 }), "invalid_argument").await;
    fails(&router, &upd, &to, json!({ "id": id, "minutes": 1441 }), "invalid_argument").await;
    fails(&router, &upd, &to, json!({ "id": id, "date": "2026-13-01" }), "invalid_argument").await;
    fails(&router, &upd, &to, json!({ "id": id, "note": "n".repeat(501) }), "invalid_argument").await;
    let after = ok(&router, &list, &to, json!({ "taskId": t, "from": "2026-10-05", "to": "2026-10-05" })).await;
    let entries = after["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 1, "from/to bound the list by work date (inclusive)");
    assert_eq!(num(&entries[0], "minutes"), 30, "rejected updates change nothing");

    // A date-only update moves the entry and keeps its minutes.
    let moved = ok(&router, &upd, &to, json!({ "id": id, "date": "2026-10-06" })).await;
    assert_eq!(moved["date"], "2026-10-06");
    assert_eq!(num(&moved, "minutes"), 30);

    // Once deleted, it is gone.
    ok(&router, &del, &to, json!({ "id": id })).await;
    fails(&router, &del, &to, json!({ "id": id }), "not_found").await;
    fails(&router, &upd, &to, json!({ "id": id, "note": "x" }), "not_found").await;
}

#[tokio::test]
async fn admins_edit_anyones_entries_and_ex_members_lose_access() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let member = mk_user(&store).await;
    let admin = mk_user(&store).await;
    let (to, tm, ta) = (token(&owner), token(&member), admin_token(&admin));
    let pid = project_with(&router, &owner, &[&member]).await;
    let m = module(&router, &to, &pid).await;
    let t = task(&router, &to, &m, "A").await;
    let log = format!("{TIME}/LogTime");

    // An admin who is not a member can log, list, edit and delete.
    let mine = ok(&router, &log, &ta, json!({ "taskId": t, "minutes": 10 })).await;
    assert_eq!(mine["userId"], admin.as_str(), "the entry belongs to the caller");
    let e = ok(&router, &log, &tm, json!({ "taskId": t, "minutes": 60 })).await;
    let list = ok(&router, &format!("{TIME}/ListTimeEntries"), &ta, json!({ "userId": member })).await;
    assert_eq!(list["entries"].as_array().unwrap().len(), 1, "admin sees a user's entries in any project");
    let upd = ok(&router, &format!("{TIME}/UpdateTimeEntry"), &ta, json!({ "id": e["id"], "minutes": 50 })).await;
    assert_eq!(num(&upd, "minutes"), 50, "admin edits another user's entry");
    assert_eq!(upd["userId"], member.as_str(), "editing does not change the author");
    ok(&router, &format!("{TIME}/DeleteTimeEntry"), &ta, json!({ "id": e["id"] })).await;
    assert_eq!(num(&get(&router, &to, &t).await, "loggedMinutes"), 10);

    // A member who leaves can no longer log or edit their own entries there.
    let e = ok(&router, &log, &tm, json!({ "taskId": t, "minutes": 20 })).await;
    ok(&router, &format!("{PROJECT}/RemoveProjectMember"), &to, json!({ "projectId": pid, "userId": member })).await;
    fails(&router, &log, &tm, json!({ "taskId": t, "minutes": 5 }), "permission_denied").await;
    fails(&router, &format!("{TIME}/UpdateTimeEntry"), &tm, json!({ "id": e["id"], "note": "x" }), "permission_denied").await;
    // Their entry still counts on the task.
    assert_eq!(num(&get(&router, &to, &t).await, "loggedMinutes"), 30);
}

#[tokio::test]
async fn concurrent_starts_leave_exactly_one_running_timer() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);
    let pid = project_with(&router, &owner, &[]).await;
    let m = module(&router, &to, &pid).await;
    let tasks = [
        task(&router, &to, &m, "A").await,
        task(&router, &to, &m, "B").await,
        task(&router, &to, &m, "C").await,
        task(&router, &to, &m, "D").await,
    ];
    let path = format!("{TIME}/StartTimer");
    let c = |i: usize| call(&router, &path, Some(&to), json!({ "taskId": tasks[i] }));
    let (r0, r1, r2, r3) = tokio::join!(c(0), c(1), c(2), c(3));
    for (st, v) in [r0, r1, r2, r3] {
        assert_eq!(st, StatusCode::OK, "every concurrent start succeeds: {v}");
    }
    let all = ok(&router, &format!("{TIME}/ListTimeEntries"), &to, json!({ "projectId": pid })).await;
    let entries = all["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 4, "one entry per start");
    let running = entries.iter().filter(|e| e["running"] == true).count();
    assert_eq!(running, 1, "only one timer is left running: {all}");
    assert!(
        entries.iter().filter(|e| e["running"] != true).all(|e| num(e, "minutes") >= 1),
        "each stopped timer recorded at least a minute"
    );
}

#[tokio::test]
async fn running_timers_stay_out_of_the_period_report() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);
    let pid = project_with(&router, &owner, &[]).await;
    let m = module(&router, &to, &pid).await;
    let t = task(&router, &to, &m, "R").await;
    ok(&router, &format!("{TIME}/LogTime"), &to, json!({ "taskId": t, "minutes": 40, "date": today() })).await;
    ok(&router, &format!("{TIME}/StartTimer"), &to, json!({ "taskId": t })).await;

    let d = time::OffsetDateTime::now_utc().date();
    let (from, to_d) = (d - time::Duration::days(1), d + time::Duration::days(1));
    let (pf, pt) = (from - time::Duration::days(2), from);
    let body = json!({
        "periodStart": format!("{from}T00:00:00Z"), "periodEnd": format!("{to_d}T00:00:00Z"),
        "prevStart": format!("{pf}T00:00:00Z"), "prevEnd": format!("{pt}T00:00:00Z"),
        "periodStartDate": from.to_string(), "periodEndDate": to_d.to_string(),
        "prevStartDate": pf.to_string(), "prevEndDate": pt.to_string(),
    });
    let r = ok(&router, &format!("{REPORT}/GetPeriodReport"), &to, body).await;
    let proj = r["perProject"].as_array().unwrap().iter().find(|p| s(p, "projectId") == pid).unwrap();
    assert_eq!(num(proj, "loggedMinutes"), 40, "the running timer is not in the report");
    ok(&router, &format!("{TIME}/StopTimer"), &to, json!({})).await;
}

#[tokio::test]
async fn deleting_a_task_or_project_leaves_no_time_entries_behind() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);
    let pid = project_with(&router, &owner, &[]).await;
    let m = module(&router, &to, &pid).await;
    let t = task(&router, &to, &m, "Doomed").await;
    let sub = s(&ok(&router, &format!("{TASK}/CreateTask"), &to,
        json!({ "moduleId": m, "title": "Doomed child", "parentId": t })).await, "id");
    ok(&router, &format!("{TIME}/LogTime"), &to, json!({ "taskId": t, "minutes": 30 })).await;
    ok(&router, &format!("{TIME}/LogTime"), &to, json!({ "taskId": sub, "minutes": 15 })).await;
    ok(&router, &format!("{TIME}/StartTimer"), &to, json!({ "taskId": t })).await;

    ok(&router, &format!("{TASK}/DeleteTask"), &to, json!({ "id": t })).await;
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM cmp_timeentry WHERE task_id = $1 OR task_id = $2")
        .bind(&t)
        .bind(&sub)
        .fetch_one(store.pool())
        .await
        .unwrap();
    assert_eq!(left, 0, "a deleted task (and its subtasks) takes its time entries with it");
    let running = ok(&router, &format!("{TIME}/GetRunningTimer"), &to, json!({})).await;
    assert!(running["entry"].is_null(), "no timer keeps running on a deleted task: {running}");

    // Bulk delete goes the same way.
    let tb = task(&router, &to, &m, "Bulk doomed").await;
    ok(&router, &format!("{TIME}/LogTime"), &to, json!({ "taskId": tb, "minutes": 10 })).await;
    ok(&router, &format!("{TASK}/BulkDeleteTasks"), &to, json!({ "taskIds": [tb] })).await;
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM cmp_timeentry WHERE task_id = $1")
        .bind(&tb)
        .fetch_one(store.pool())
        .await
        .unwrap();
    assert_eq!(left, 0, "bulk-deleted tasks take their time entries with them");

    // A module: every task in it, a running timer on a subtask included.
    let m2 = module(&router, &to, &pid).await;
    let mt = task(&router, &to, &m2, "In module").await;
    let ms = s(&ok(&router, &format!("{TASK}/CreateTask"), &to,
        json!({ "moduleId": m2, "title": "Module child", "parentId": mt })).await, "id");
    ok(&router, &format!("{TIME}/LogTime"), &to, json!({ "taskId": mt, "minutes": 25 })).await;
    ok(&router, &format!("{TIME}/StartTimer"), &to, json!({ "taskId": ms })).await;
    ok(&router, &format!("{MODULE}/DeleteModule"), &to, json!({ "id": m2 })).await;
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM cmp_timeentry WHERE task_id = $1 OR task_id = $2")
        .bind(&mt)
        .bind(&ms)
        .fetch_one(store.pool())
        .await
        .unwrap();
    assert_eq!(left, 0, "a deleted module takes its tasks' time entries with it");
    let running = ok(&router, &format!("{TIME}/GetRunningTimer"), &to, json!({})).await;
    assert!(running["entry"].is_null(), "the subtask's timer is gone with the module: {running}");

    // Same for a whole project, and its time leaves the reports.
    let t2 = task(&router, &to, &m, "Also doomed").await;
    ok(&router, &format!("{TIME}/LogTime"), &to, json!({ "taskId": t2, "minutes": 20 })).await;
    ok(&router, &format!("{PROJECT}/DeleteProject"), &to, json!({ "id": pid })).await;
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM cmp_timeentry WHERE project_id = $1")
        .bind(&pid)
        .fetch_one(store.pool())
        .await
        .unwrap();
    assert_eq!(left, 0, "a deleted project leaves no time entries behind");
}


// ── Time entries in the activity log ─────────────────────────────────────────

/// TIME_ENTRY rows in a task's activity, newest first.
async fn time_rows(router: &Router, tok: &str, task: &str) -> Vec<Value> {
    let v = ok(router, &format!("{ACTIVITY}/ListEntityActivity"), tok, json!({ "entityType": "TASK", "entityId": task })).await;
    v["activities"].as_array().cloned().unwrap_or_default().into_iter().filter(|a| a["entityType"] == "TIME_ENTRY").collect()
}

/// `field → (from, to)` of an activity row.
fn changes(a: &Value) -> std::collections::HashMap<String, (Value, Value)> {
    a["changes"].as_array().cloned().unwrap_or_default().into_iter()
        .map(|c| (s(&c, "field"), (c["from"].clone(), c["to"].clone())))
        .collect()
}

#[tokio::test]
async fn time_changes_are_recorded_in_the_activity_log() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, member, admin, outsider) = (mk_user(&store).await, mk_user(&store).await, mk_user(&store).await, mk_user(&store).await);
    let (to, tm, ta) = (token(&owner), token(&member), admin_token(&admin));
    let pid = project_with(&router, &owner, &[&member]).await;
    let m = module(&router, &to, &pid).await;
    let t = task(&router, &to, &m, "Design").await;
    let t2 = task(&router, &to, &m, "Build").await;
    let n = num(&get(&router, &to, &t).await, "number");

    // Log: one CREATED row by the member, linked to the task.
    let e = ok(&router, &format!("{TIME}/LogTime"), &tm, json!({ "taskId": t, "minutes": 90, "date": "2026-10-02", "note": "review" })).await;
    let rows = time_rows(&router, &tm, &t).await;
    assert_eq!(rows.len(), 1, "one row per log: {rows:?}");
    let r = &rows[0];
    assert_eq!(r["action"], "CREATED");
    assert_eq!(r["actorId"], member.as_str());
    assert_eq!(r["entityId"], e["id"], "the row is about the entry");
    assert_eq!(r["taskId"], t.as_str(), "and linked to its task");
    assert_eq!(r["projectId"], pid.as_str());
    assert_eq!(r["summary"], format!("logged 1h 30m on #{n}"), "{r}");
    let c = changes(r);
    assert_eq!(c["minutes"].1, json!("1h 30m"), "minutes read as a duration: {r}");
    assert_eq!(c["date"].1, json!("2026-10-02"));
    assert_eq!(c["note"].1, json!("review"));
    assert!(c.values().all(|(from, _)| from.is_null()), "a new entry has no from values: {r}");
    ok(&router, &format!("{TIME}/LogTime"), &tm, json!({ "taskId": t, "minutes": 5, "date": "2026-10-02" })).await;
    let plain = time_rows(&router, &tm, &t).await[0].clone();
    assert!(!changes(&plain).contains_key("note"), "no note, no note change: {plain}");

    // Timers: starting records nothing; an implicit stop and an explicit stop each record one row.
    ok(&router, &format!("{TIME}/StartTimer"), &tm, json!({ "taskId": t })).await;
    assert_eq!(time_rows(&router, &tm, &t).await.len(), 2, "starting a timer records nothing");
    ok(&router, &format!("{TIME}/StartTimer"), &tm, json!({ "taskId": t2 })).await;
    let rows = time_rows(&router, &tm, &t).await;
    assert_eq!(rows.len(), 3, "the timer stopped by starting another is recorded on its own task");
    assert_eq!(rows[0]["action"], "CREATED");
    assert_eq!(changes(&rows[0])["minutes"].1, json!("1m"));
    assert!(time_rows(&router, &tm, &t2).await.is_empty(), "the new timer is not recorded yet");
    ok(&router, &format!("{TIME}/StopTimer"), &tm, json!({})).await;
    let rows2 = time_rows(&router, &tm, &t2).await;
    assert_eq!(rows2.len(), 1, "an explicit stop records one row");
    assert_eq!(rows2[0]["summary"], format!("logged 1m on #{}", num(&get(&router, &to, &t2).await, "number")));

    // An admin's edit: UPDATED, actor = the admin, from/to only for what changed.
    let upd = format!("{TIME}/UpdateTimeEntry");
    ok(&router, &upd, &ta, json!({ "id": e["id"], "minutes": 60, "note": "review" })).await;
    let r = time_rows(&router, &tm, &t).await[0].clone();
    assert_eq!(r["action"], "UPDATED");
    assert_eq!(r["actorId"], admin.as_str(), "the editor, not the author");
    assert_eq!(r["summary"], format!("edited time on #{n}"));
    let c = changes(&r);
    assert_eq!(c.len(), 1, "only minutes changed: {r}");
    assert_eq!(c["minutes"], (json!("1h 30m"), json!("1h")));
    // A no-op edit writes nothing.
    let before = time_rows(&router, &tm, &t).await.len();
    ok(&router, &upd, &tm, json!({ "id": e["id"], "minutes": 60, "date": "2026-10-02", "note": "review" })).await;
    assert_eq!(time_rows(&router, &tm, &t).await.len(), before, "a no-op edit records nothing");
    ok(&router, &upd, &tm, json!({ "id": e["id"], "date": "2026-10-03", "note": "" })).await;
    let c = changes(&time_rows(&router, &tm, &t).await[0]);
    assert_eq!(c["date"], (json!("2026-10-02"), json!("2026-10-03")));
    assert!(c.contains_key("note"), "clearing the note is a change: {c:?}");
    assert!(!c.contains_key("minutes"));

    // Delete: DELETED with the from values.
    ok(&router, &format!("{TIME}/DeleteTimeEntry"), &tm, json!({ "id": e["id"] })).await;
    let r = time_rows(&router, &tm, &t).await[0].clone();
    assert_eq!(r["action"], "DELETED");
    assert_eq!(r["actorId"], member.as_str());
    assert_eq!(r["summary"], format!("deleted 1h logged on #{n}"));
    let c = changes(&r);
    assert_eq!(c["minutes"].0, json!("1h"));
    assert_eq!(c["date"].0, json!("2026-10-03"));

    // The project log shows them too.
    let proj = ok(&router, &format!("{ACTIVITY}/ListProjectActivity"), &to, json!({ "projectId": pid })).await;
    let in_proj = proj["activities"].as_array().unwrap().iter().filter(|a| a["entityType"] == "TIME_ENTRY").count();
    assert_eq!(in_proj, 7, "log, log, implicit stop, stop, admin edit, edit, delete: all seven in the project log (the no-op edit wrote none): {proj}");

    // Outsiders see neither the task's nor the entry's activity.
    fails(&router, &format!("{ACTIVITY}/ListEntityActivity"), &token(&outsider), json!({ "entityType": "TASK", "entityId": t }), "permission_denied").await;
    fails(&router, &format!("{ACTIVITY}/ListEntityActivity"), &token(&outsider), json!({ "entityType": "TIME_ENTRY", "entityId": e["id"] }), "permission_denied").await;

    // Cascades write no per-entry rows.
    let doomed = task(&router, &to, &m, "Doomed").await;
    ok(&router, &format!("{TIME}/LogTime"), &tm, json!({ "taskId": doomed, "minutes": 10 })).await;
    let count = |router: Router, to: String, pid: String| async move {
        let v = ok(&router, &format!("{ACTIVITY}/ListProjectActivity"), &to, json!({ "projectId": pid })).await;
        v["activities"].as_array().unwrap().iter().filter(|a| a["entityType"] == "TIME_ENTRY").count()
    };
    let before = count(router.clone(), to.clone(), pid.clone()).await;
    ok(&router, &format!("{TASK}/DeleteTask"), &to, json!({ "id": doomed })).await;
    assert_eq!(count(router.clone(), to.clone(), pid.clone()).await, before, "deleting a task adds no time-entry rows");

    // The period report's activity summary counts them.
    let d = time::OffsetDateTime::now_utc().date();
    let (from, until) = (d - time::Duration::days(1), d + time::Duration::days(2));
    let r = ok(&router, &format!("{REPORT}/GetPeriodReport"), &to, json!({
        "periodStart": format!("{from}T00:00:00Z"), "periodEnd": format!("{until}T00:00:00Z"),
        "periodStartDate": from.to_string(), "periodEndDate": until.to_string(),
    })).await;
    let te: Vec<&Value> = r["activitySummary"].as_array().unwrap().iter().filter(|x| x["entityType"] == "TIME_ENTRY").collect();
    let created = te.iter().filter(|x| x["action"] == "CREATED").map(|x| num(x, "count")).sum::<i64>();
    assert!(created >= 5, "the summary counts time-entry rows (this project alone made 5 CREATED): {te:?}");
    assert!(te.iter().any(|x| x["action"] == "UPDATED") && te.iter().any(|x| x["action"] == "DELETED"));
}
