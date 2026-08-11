//! End-to-end Dashboard & My-Tasks aggregation, member-scoped. Skipped unless
//! `DATABASE_URL` is set. The caller `M` is a fresh user each run → scope = this
//! run's project only, so reruns on the persistent DB stay isolated.

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
const COMMENT: &str = "/sedjiwa.tasks.comment.v1.CommentService";
const DASH: &str = "/sedjiwa.tasks.dashboard.v1.DashboardService";
const MY: &str = "/sedjiwa.tasks.dashboard.v1.MyTasksService";

fn uniq() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos().to_string()
}

fn date_offset(days: i64) -> String {
    (time::OffsetDateTime::now_utc() + time::Duration::days(days)).date().to_string()
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
        .merge(transport::comment_router(store.clone()))
        .merge(transport::dashboard_router(store.clone()))
        .merge(transport::mytasks_router(store.clone()))
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

fn num(body: &Value, key: &str) -> u64 {
    body[key].as_u64().unwrap_or(0)
}

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

async fn create_task(router: &Router, tok: &str, module: &str, body: Value) -> String {
    let mut b = body;
    b["moduleId"] = json!(module);
    ok(router, &format!("{TASK}/CreateTask"), tok, b).await["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn dashboard_and_my_tasks_scoped() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let me = mk_user(&store).await;
    let (to, tm) = (token(&owner), token(&me));

    // P1: owner + me. Module m1.
    let p1 = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("P1-{}", uniq()) })).await["id"].as_str().unwrap().to_string();
    ok(&router, &format!("{PROJECT}/AddProjectMember"), &to, json!({ "projectId": p1, "userId": me })).await;
    let m1 = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": p1, "name": "M1" })).await["id"].as_str().unwrap().to_string();

    // A: assigned me, due yesterday, todo (overdue). B: assigned me, due +3, todo (upcoming).
    let _a = create_task(&router, &to, &m1, json!({ "title": "A", "assigneeIds": [me], "dueDate": date_offset(-1) })).await;
    let b = create_task(&router, &to, &m1, json!({ "title": "B", "assigneeIds": [me], "dueDate": date_offset(3) })).await;
    // C: created by me, done. D: in_progress (me will comment). E: cancelled.
    let _c = create_task(&router, &tm, &m1, json!({ "title": "C", "status": "DONE" })).await;
    let d = create_task(&router, &to, &m1, json!({ "title": "D", "status": "IN_PROGRESS" })).await;
    let _e = create_task(&router, &to, &m1, json!({ "title": "E", "status": "CANCELLED" })).await;
    // me comments on D → "involving me".
    ok(&router, &format!("{COMMENT}/CreateComment"), &tm, json!({ "taskId": d, "content": "looking" })).await;

    // P2: owner only (me NOT a member) — must be excluded from me's aggregates.
    let p2 = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("P2-{}", uniq()) })).await["id"].as_str().unwrap().to_string();
    let m2 = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": p2, "name": "M2" })).await["id"].as_str().unwrap().to_string();
    create_task(&router, &to, &m2, json!({ "title": "P2-task" })).await;

    // Dashboard stats (as me): scoped to P1 only.
    let stats = ok(&router, &format!("{DASH}/GetDashboardStats"), &tm, json!({})).await;
    assert_eq!(num(&stats, "totalTasks"), 4, "non-cancelled in P1 (A,B,C,D): {stats}");
    assert_eq!(num(&stats, "inProgressTasks"), 1);
    assert_eq!(num(&stats, "doneTasks"), 1);
    assert_eq!(num(&stats, "overdueTasks"), 1, "A is overdue");
    let pp = stats["perProject"].as_array().unwrap();
    assert_eq!(pp.len(), 1, "only P1 in scope");
    assert_eq!(pp[0]["projectId"], p1);
    assert_eq!(num(&pp[0], "total"), 4);
    assert_eq!(num(&pp[0], "done"), 1);

    // Upcoming deadlines (within 7): only B (A is in the past).
    let up = ok(&router, &format!("{DASH}/GetUpcomingDeadlines"), &tm, json!({ "withinDays": 7 })).await;
    let items = up["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["task"]["id"], b);
    assert_eq!(items[0]["projectId"], p1);

    // My-Tasks: assigned {A,B}=2, created {C}=1, involving {D}=1.
    let assigned = ok(&router, &format!("{MY}/ListAssignedToMe"), &tm, json!({})).await;
    assert_eq!(num(&assigned, "total"), 2);
    let created = ok(&router, &format!("{MY}/ListCreatedByMe"), &tm, json!({})).await;
    assert_eq!(num(&created, "total"), 1);
    assert_eq!(created["items"][0]["task"]["title"], "C");
    let involving = ok(&router, &format!("{MY}/ListInvolvingMe"), &tm, json!({})).await;
    assert_eq!(num(&involving, "total"), 1);
    assert_eq!(involving["items"][0]["task"]["id"], d);

    // Filter: assigned + status TODO → {A,B} (both todo); status DONE → none.
    let todo = ok(&router, &format!("{MY}/ListAssignedToMe"), &tm, json!({ "status": "TODO" })).await;
    assert_eq!(num(&todo, "total"), 2);
    let done_assigned = ok(&router, &format!("{MY}/ListAssignedToMe"), &tm, json!({ "status": "DONE" })).await;
    assert_eq!(num(&done_assigned, "total"), 0);
}

#[tokio::test]
async fn project_overview_counts_and_gating() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let outsider = mk_user(&store).await;
    let (to, tx) = (token(&owner), token(&outsider));

    let p = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("OV-{}", uniq()) }))
        .await["id"]
        .as_str()
        .unwrap()
        .to_string();
    let m1 = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": p, "name": "M1" }))
        .await["id"]
        .as_str()
        .unwrap()
        .to_string();
    // M2 stays empty → it must still appear in perModule as 0/0.
    let m2 = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": p, "name": "M2" }))
        .await["id"]
        .as_str()
        .unwrap()
        .to_string();

    // A: overdue (due yesterday, todo). B: due yesterday but DONE → not overdue.
    // C: in progress. D: cancelled → counted nowhere.
    create_task(&router, &to, &m1, json!({ "title": "A", "dueDate": date_offset(-1) })).await;
    create_task(&router, &to, &m1, json!({ "title": "B", "status": "DONE", "dueDate": date_offset(-1) })).await;
    create_task(&router, &to, &m1, json!({ "title": "C", "status": "IN_PROGRESS" })).await;
    create_task(&router, &to, &m1, json!({ "title": "D", "status": "CANCELLED" })).await;

    let ov = ok(&router, &format!("{DASH}/GetProjectOverview"), &to, json!({ "projectId": p })).await;
    assert_eq!(num(&ov, "totalTasks"), 3, "A,B,C — cancelled D excluded: {ov}");
    assert_eq!(num(&ov, "inProgressTasks"), 1);
    assert_eq!(num(&ov, "doneTasks"), 1);
    assert_eq!(num(&ov, "overdueTasks"), 1, "A only — B is past due but done");
    assert_eq!(num(&ov, "moduleCount"), 2);
    assert_eq!(num(&ov, "pageCount"), 0);
    assert_eq!(num(&ov, "mediaCount"), 0);

    let per = ov["perModule"].as_array().unwrap();
    assert_eq!(per.len(), 2, "empty modules still listed: {ov}");
    assert_eq!(per[0]["moduleId"], m1);
    assert_eq!(num(&per[0], "total"), 3);
    assert_eq!(num(&per[0], "done"), 1);
    assert_eq!(per[1]["moduleId"], m2);
    assert_eq!(num(&per[1], "total"), 0);
    assert_eq!(num(&per[1], "done"), 0);

    // Owner leads the member list.
    let members = ov["memberIds"].as_array().unwrap();
    assert_eq!(members[0], owner, "owner first: {ov}");

    // Gating: a non-member is denied; an unknown project is not found.
    let (st, _) = call(&router, &format!("{DASH}/GetProjectOverview"), Some(&tx), json!({ "projectId": p })).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "non-member must be denied");
    let (st, _) = call(&router, &format!("{DASH}/GetProjectOverview"), Some(&to), json!({ "projectId": "999999999" })).await;
    assert_eq!(st, StatusCode::NOT_FOUND, "unknown project id");

    // Empty project → all zeros.
    let empty = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("OV-empty-{}", uniq()) }))
        .await["id"]
        .as_str()
        .unwrap()
        .to_string();
    let z = ok(&router, &format!("{DASH}/GetProjectOverview"), &to, json!({ "projectId": empty })).await;
    assert_eq!(num(&z, "totalTasks"), 0);
    assert_eq!(num(&z, "moduleCount"), 0);
    assert!(z["perModule"].as_array().map(|a| a.is_empty()).unwrap_or(true), "{z}");
}
