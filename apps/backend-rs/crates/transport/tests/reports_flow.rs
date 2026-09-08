//! End-to-end periodic reports, member-scoped. Skipped unless `DATABASE_URL` is
//! set. Every caller is a fresh user, so scope = this run's projects only and
//! reruns on the persistent dev DB stay isolated.

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
const REPORT: &str = "/sedjiwa.tasks.reports.v1.ReportService";

fn uniq() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos().to_string()
}

/// A window wide enough to hold everything this run creates: yesterday to
/// tomorrow. The report is asked about instants, so these are instants.
fn window() -> (String, String, String, String) {
    use time::format_description::well_known::Rfc3339;
    let fmt = |d: i64| {
        (time::OffsetDateTime::now_utc() + time::Duration::days(d))
            .format(&Rfc3339)
            .unwrap()
    };
    (fmt(-1), fmt(1), fmt(-3), fmt(-1))
}

/// The same window as plain calendar dates, for `start_date`. The service
/// requires these alongside the instants; the tests run in UTC, so here the
/// two agree, which is exactly why the date bounds cannot be *derived* from
/// the instants in the real client.
fn window_dates() -> (String, String, String, String) {
    let d = |n: i64| {
        (time::OffsetDateTime::now_utc() + time::Duration::days(n))
            .date()
            .to_string()
    };
    (d(-1), d(1), d(-3), d(-1))
}

/// Request body for the common case: the whole window, no list cap.
fn full_window_body() -> Value {
    let (s, e, ps, pe) = window();
    let (sd, ed, psd, ped) = window_dates();
    json!({
        "periodStart": s, "periodEnd": e, "prevStart": ps, "prevEnd": pe,
        "periodStartDate": sd, "periodEndDate": ed,
        "prevStartDate": psd, "prevEndDate": ped,
    })
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
        .merge(transport::report_router(store.clone()))
        .layer(from_fn(auth_mw));
    Some((router, store))
}

fn token(sub: &str) -> String {
    sign_jwt(SECRET, sub, &["projects:create".to_string()], 9_999_999_999).unwrap()
}

async fn call(router: &Router, path: &str, token: Option<&str>, body: Value) -> (StatusCode, Value) {
    let mut b = Request::builder().method("POST").uri(path).header(CONTENT_TYPE, "application/json");
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

async fn mk_user(store: &Store) -> String {
    let now = "2026-01-01T00:00:00Z".to_string();
    store
        .create((
            UserPhone { value: format!("r{}", uniq()), verified: true },
            UserPassword { hash: "x".into(), changed_at: now.clone() },
            UserProfile { display_name: "R".into(), avatar_url: String::new(), email: String::new() },
            UserStatusComponent { status: "active".into(), created_at: now, last_login_at: None },
        ))
        .await
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn rejects_a_malformed_window() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let me = mk_user(&store).await;
    let tm = token(&me);

    // An inverted window is a caller error. It must not come back as an empty
    // report, which is a legitimate answer and would hide the bug.
    let (st, body) = call(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        Some(&tm),
        json!({ "periodStart": "2026-09-14T00:00:00Z", "periodEnd": "2026-09-07T00:00:00Z",
                 "periodStartDate": "2026-09-07", "periodEndDate": "2026-09-14" }),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "{body}");

    let (st, body) = call(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        Some(&tm),
        json!({ "periodStart": "not-a-time", "periodEnd": "2026-09-07T00:00:00Z",
                 "periodStartDate": "2026-09-07", "periodEndDate": "2026-09-14" }),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "{body}");

    // Both prevStart and prevEnd empty means "no comparison" — that's valid.
    // But a `prevStart` with no matching `prevEnd` is not "no comparison", it
    // is a malformed window, and must be rejected rather than silently
    // dropped. A regression to `Window::parse(...).ok()` would instead read
    // as "no comparison shown", which looks like a missing feature, not a
    // bug — so this has to be asserted explicitly.
    let (st, body) = call(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        Some(&tm),
        json!({
            "periodStart": "2026-09-07T00:00:00Z",
            "periodStartDate": "2026-09-07", "periodEndDate": "2026-09-14",
            "periodEnd": "2026-09-14T00:00:00Z",
            "prevStart": "2026-08-31T00:00:00Z",
            "prevEnd": "",
        }),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "{body}");
}

#[tokio::test]
async fn requires_authentication() {
    let Some((router, _store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (s, e, _, _) = window();
    let (sd, ed, _, _) = window_dates();
    let (st, _) = call(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        None,
        json!({ "periodStart": s, "periodEnd": e,
                 "periodStartDate": sd, "periodEndDate": ed }),
    )
    .await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn empty_scope_reports_zero() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    // A user who is a member of no project: every count is zero and no row
    // leaks from anyone else's projects.
    let me = mk_user(&store).await;
        let r = ok(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        &token(&me),
        full_window_body(),
    )
    .await;
    assert_eq!(r["totals"]["completed"].as_u64().unwrap_or(0), 0, "{r}");
    assert_eq!(r["totals"]["started"].as_u64().unwrap_or(0), 0, "{r}");
    assert!(r["perProject"].as_array().map(|a| a.is_empty()).unwrap_or(true), "{r}");
    assert!(r["perMember"].as_array().map(|a| a.is_empty()).unwrap_or(true), "{r}");
    assert_eq!(r["activityTotal"].as_u64().unwrap_or(0), 0, "{r}");
}

#[tokio::test]
async fn activity_is_summarised_for_the_window_and_scope() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let me = mk_user(&store).await;
    let tm = token(&me);

    // One project, one module, two tasks -> activity rows written by the
    // mutation handlers themselves.
    let p = ok(&router, &format!("{PROJECT}/CreateProject"), &tm, json!({ "name": format!("R-{}", uniq()) })).await
        ["id"].as_str().unwrap().to_string();
    let m = ok(&router, &format!("{MODULE}/CreateModule"), &tm, json!({ "projectId": p, "name": "M" })).await
        ["id"].as_str().unwrap().to_string();
    let t1 = ok(&router, &format!("{TASK}/CreateTask"), &tm, json!({ "moduleId": m, "title": "one" })).await
        ["id"].as_str().unwrap().to_string();
    ok(&router, &format!("{TASK}/UpdateTask"), &tm, json!({ "id": t1, "title": "one edited" })).await;

        let r = ok(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        &tm,
        full_window_body(),
    )
    .await;

    let total = r["activityTotal"].as_u64().unwrap_or(0);
    assert!(total >= 3, "module create + task create + task update: {r}");
    let rows = r["activitySummary"].as_array().unwrap();
    assert!(!rows.is_empty(), "{r}");
    assert!(
        rows.iter().all(|row| row["count"].as_u64().unwrap_or(0) > 0),
        "zero rows must be dropped: {r}"
    );
    let created_tasks = rows.iter().find(|row| row["entityType"] == "TASK" && row["action"] == "CREATED");
    assert!(created_tasks.is_some(), "a TASK/CREATED row is expected: {r}");
    // TASK=1/CREATED=1 would still pass even if entityType and action were
    // transposed at construction, since both proto-encode as 1. MODULE=2 vs
    // CREATED=1 breaks that symmetry, so this catches a field swap the
    // assertion above cannot.
    let created_modules = rows.iter().find(|row| row["entityType"] == "MODULE" && row["action"] == "CREATED");
    assert!(created_modules.is_some(), "a MODULE/CREATED row is expected: {r}");

    // A window in the far past sees none of it.
    let r_old = ok(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        &tm,
        json!({ "periodStart": "2020-01-01T00:00:00Z", "periodEnd": "2020-01-08T00:00:00Z",
                 "periodStartDate": "2020-01-01", "periodEndDate": "2020-01-08" }),
    )
    .await;
    assert_eq!(r_old["activityTotal"].as_u64().unwrap_or(0), 0, "{r_old}");
}

#[tokio::test]
async fn report_is_member_scoped_and_counts_the_window() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let me = mk_user(&store).await;
    let (to, tm) = (token(&owner), token(&me));

    // P1: owner + me.
    let p1 = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("RP1-{}", uniq()) })).await
        ["id"].as_str().unwrap().to_string();
    ok(&router, &format!("{PROJECT}/AddProjectMember"), &to, json!({ "projectId": p1, "userId": me })).await;
    let m1 = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": p1, "name": "M1" })).await
        ["id"].as_str().unwrap().to_string();

    // A: done and assigned to me -> completed this window, for me.
    let a = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m1, "title": "A", "assigneeIds": [me] })).await
        ["id"].as_str().unwrap().to_string();
    ok(&router, &format!("{TASK}/UpdateTask"), &to, json!({ "id": a, "status": "DONE" })).await;
    // B: open, assigned to me, due long ago -> still_open + overdue now.
    ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m1, "title": "B", "assigneeIds": [me], "dueDate": "2020-01-01" })).await;
    // C: cancelled -> counts nowhere.
    ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m1, "title": "C", "status": "CANCELLED" })).await;

    // P2: owner only. Must not appear in me's report at all.
    let p2 = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("RP2-{}", uniq()) })).await
        ["id"].as_str().unwrap().to_string();
    let m2 = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": p2, "name": "M2" })).await
        ["id"].as_str().unwrap().to_string();
    ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m2, "title": "hidden" })).await;

        let r = ok(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        &tm,
        full_window_body(),
    )
    .await;

    assert_eq!(r["totals"]["completed"].as_u64().unwrap(), 1, "A: {r}");
    assert_eq!(r["totals"]["started"].as_u64().unwrap(), 2, "A and B; C is cancelled: {r}");
    assert_eq!(r["totals"]["stillOpen"].as_u64().unwrap(), 1, "B: {r}");
    assert_eq!(r["totals"]["overdue"].as_u64().unwrap(), 1, "B: {r}");
    assert!(r["prevTotals"].is_object(), "a comparison window was sent: {r}");
    assert_eq!(r["prevTotals"]["completed"].as_u64().unwrap_or(0), 0, "{r}");

    let projects = r["perProject"].as_array().unwrap();
    assert_eq!(projects.len(), 1, "P2 is out of scope: {r}");
    assert_eq!(projects[0]["projectId"], p1);
    assert_eq!(projects[0]["total"].as_u64().unwrap(), 2, "cancelled excluded: {r}");
    assert_eq!(projects[0]["doneTotal"].as_u64().unwrap(), 1);

    let members = r["perMember"].as_array().unwrap();
    let mine = members.iter().find(|m| m["userId"] == me).expect("a row for me");
    assert_eq!(mine["completed"].as_u64().unwrap(), 1);
    assert_eq!(mine["openAssigned"].as_u64().unwrap(), 1);
    assert_eq!(mine["overdueAssigned"].as_u64().unwrap(), 1);
    assert_eq!(mine["userName"], "R", "display name is joined in");

    let completed = r["completedTasks"].as_array().unwrap();
    assert_eq!(completed.len(), 1);
    assert_eq!(completed[0]["task"]["title"], "A");
    assert_eq!(completed[0]["projectName"], projects[0]["projectName"]);
    assert!(!r["completedTruncated"].as_bool().unwrap_or(false), "{r}");

    let late = r["overdueTasks"].as_array().unwrap();
    assert_eq!(late.len(), 1);
    assert_eq!(late[0]["task"]["title"], "B");

    // No comparison window -> no prevTotals.
    let (s, e, _, _) = window();
    let (sd, ed, _, _) = window_dates();
    let no_prev = ok(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        &tm,
        json!({ "periodStart": s, "periodEnd": e,
                 "periodStartDate": sd, "periodEndDate": ed }),
    )
    .await;
    assert!(no_prev["prevTotals"].is_null(), "{no_prev}");
}

#[tokio::test]
async fn list_limit_truncates_and_says_so() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let me = mk_user(&store).await;
    let tm = token(&me);
    let p = ok(&router, &format!("{PROJECT}/CreateProject"), &tm, json!({ "name": format!("RL-{}", uniq()) })).await
        ["id"].as_str().unwrap().to_string();
    let m = ok(&router, &format!("{MODULE}/CreateModule"), &tm, json!({ "projectId": p, "name": "M" })).await
        ["id"].as_str().unwrap().to_string();
    for i in 0..3 {
        let id = ok(&router, &format!("{TASK}/CreateTask"), &tm, json!({ "moduleId": m, "title": format!("t{i}") })).await
            ["id"].as_str().unwrap().to_string();
        ok(&router, &format!("{TASK}/UpdateTask"), &tm, json!({ "id": id, "status": "DONE" })).await;
    }
    let (s, e, _, _) = window();
    let (sd, ed, _, _) = window_dates();
    let r = ok(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        &tm,
        json!({ "periodStart": s, "periodEnd": e,
                 "periodStartDate": sd, "periodEndDate": ed, "listLimit": 2 }),
    )
    .await;
    assert_eq!(r["completedTasks"].as_array().unwrap().len(), 2, "{r}");
    assert_eq!(r["completedTruncated"], true, "{r}");
    assert_eq!(r["totals"]["completed"].as_u64().unwrap(), 3, "totals are not capped: {r}");
}
