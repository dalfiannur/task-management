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
        json!({ "periodStart": "2026-09-14T00:00:00Z", "periodEnd": "2026-09-07T00:00:00Z" }),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "{body}");

    let (st, body) = call(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        Some(&tm),
        json!({ "periodStart": "not-a-time", "periodEnd": "2026-09-07T00:00:00Z" }),
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
    let (st, _) = call(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        None,
        json!({ "periodStart": s, "periodEnd": e }),
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
    let (s, e, ps, pe) = window();
    let r = ok(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        &token(&me),
        json!({ "periodStart": s, "periodEnd": e, "prevStart": ps, "prevEnd": pe }),
    )
    .await;
    assert_eq!(r["totals"]["completed"].as_u64().unwrap_or(0), 0, "{r}");
    assert_eq!(r["totals"]["created"].as_u64().unwrap_or(0), 0, "{r}");
    assert!(r["perProject"].as_array().map(|a| a.is_empty()).unwrap_or(true), "{r}");
    assert!(r["perMember"].as_array().map(|a| a.is_empty()).unwrap_or(true), "{r}");
}
