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
use calamine::{Data, Reader, Xlsx};
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
}
