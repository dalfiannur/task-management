//! End-to-end activity: mutations record audit rows; feeds are member-scoped.
//! Skipped unless `DATABASE_URL` is set.

use std::collections::HashSet;
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
const PAGE: &str = "/sedjiwa.tasks.page.v1.PageService";
const ACT: &str = "/sedjiwa.tasks.activity.v1.ActivityService";

fn uniq() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos().to_string()
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
        .merge(transport::page_router(store.clone()))
        .merge(transport::activity_router(store.clone()))
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
            UserPhone { value: format!("m{}", uniq()), verified: true },
            UserPassword { hash: "x".into(), changed_at: now.clone() },
            UserProfile { display_name: "M".into(), avatar_url: String::new(), email: String::new() },
            UserStatusComponent { status: "active".into(), created_at: now, last_login_at: None },
        ))
        .await
        .unwrap()
        .to_string()
}

fn entity_types(body: &Value) -> HashSet<String> {
    body["activities"].as_array().cloned().unwrap_or_default().iter().map(|a| a["entityType"].as_str().unwrap().to_string()).collect()
}
fn actions(body: &Value) -> Vec<String> {
    body["activities"].as_array().cloned().unwrap_or_default().iter().map(|a| a["action"].as_str().unwrap().to_string()).collect()
}

#[tokio::test]
async fn activity_recorded_and_feeds_scoped() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let member = mk_user(&store).await;
    let member2 = mk_user(&store).await;
    let outsider = mk_user(&store).await;
    let (to, tm) = (token(&owner), token(&member));

    let p = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("P{}", uniq()) })).await;
    let pid = p["id"].as_str().unwrap().to_string();
    ok(&router, &format!("{PROJECT}/AddProjectMember"), &to, json!({ "projectId": pid, "userId": member })).await; // Membership·Created

    // Module + task + task update (Task·Updated with a diff).
    let m = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": pid, "name": "Backlog" })).await["id"].as_str().unwrap().to_string();
    let task = ok(&router, &format!("{TASK}/CreateTask"), &tm, json!({ "moduleId": m, "title": "T" })).await["id"].as_str().unwrap().to_string();
    ok(&router, &format!("{TASK}/UpdateTask"), &tm, json!({ "id": task, "status": "DONE" })).await;

    // Page + membership + ownership transfer.
    ok(&router, &format!("{PAGE}/CreatePage"), &tm, json!({ "projectId": pid, "title": "Spec" })).await; // Page·Created
    ok(&router, &format!("{PROJECT}/AddProjectMember"), &to, json!({ "projectId": pid, "userId": member2 })).await;
    ok(&router, &format!("{PROJECT}/TransferProjectOwnership"), &to, json!({ "id": pid, "newOwnerId": member2 })).await; // Ownership·Updated

    // Project feed (member-scoped): all entity types present, newest-first.
    let feed = ok(&router, &format!("{ACT}/ListProjectActivity"), &tm, json!({ "projectId": pid })).await;
    let want: HashSet<String> = ["MODULE", "TASK", "PAGE", "MEMBERSHIP", "OWNERSHIP"].iter().map(|s| s.to_string()).collect();
    assert!(want.is_subset(&entity_types(&feed)), "feed types {:?}", entity_types(&feed));
    // Newest first: the last mutation (ownership transfer) is first.
    assert_eq!(feed["activities"][0]["entityType"], "OWNERSHIP");

    // Non-member denied.
    let (st, _) = call(&router, &format!("{ACT}/ListProjectActivity"), Some(&token(&outsider)), json!({ "projectId": pid })).await;
    assert_ne!(st, StatusCode::OK, "non-member cannot read project activity");

    // Entity feed: the task has exactly Created + Updated, and the update carries a diff.
    let te = ok(&router, &format!("{ACT}/ListEntityActivity"), &tm, json!({ "entityType": "TASK", "entityId": task })).await;
    let mut acts = actions(&te);
    acts.sort();
    assert_eq!(acts, vec!["CREATED".to_string(), "UPDATED".to_string()]);
    let updated = te["activities"].as_array().unwrap().iter().find(|a| a["action"] == "UPDATED").unwrap();
    let fields: Vec<&str> = updated["changes"].as_array().unwrap().iter().map(|c| c["field"].as_str().unwrap()).collect();
    assert!(fields.contains(&"status"), "update diff has status: {updated}");

    // Recent (cross-project) is member-scoped: member sees P's activity, outsider sees none.
    let recent = ok(&router, &format!("{ACT}/ListRecentActivity"), &tm, json!({})).await;
    assert!(recent["activities"].as_array().unwrap().iter().any(|a| a["projectId"] == pid));
    let none = ok(&router, &format!("{ACT}/ListRecentActivity"), &token(&outsider), json!({})).await;
    assert!(none["activities"].as_array().map(|a| a.is_empty()).unwrap_or(true), "outsider has no recent activity");
}

/// The project feed must contain ONLY its own project's rows.
///
/// Guards the SQL predicate in `activity_for_project`. The filter used to run in
/// Rust after hydrating every activity row in the database, so cross-project
/// leakage was impossible by construction and nothing tested for it; once the
/// filter moved into the predicate, a wrong or missing one silently leaks every
/// other project's audit trail to any member of any project.
#[tokio::test]
async fn project_feed_excludes_other_projects() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);

    // Two projects owned by the same user, each with activity of its own.
    let a = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("A{}", uniq()) })).await["id"].as_str().unwrap().to_string();
    let b = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("B{}", uniq()) })).await["id"].as_str().unwrap().to_string();
    ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": a, "name": "OnlyInA" })).await;
    ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": b, "name": "OnlyInB" })).await;

    let feed = ok(&router, &format!("{ACT}/ListProjectActivity"), &to, json!({ "projectId": a })).await;
    let rows = feed["activities"].as_array().unwrap();
    assert!(!rows.is_empty(), "project A has activity of its own");
    assert!(
        rows.iter().all(|r| r["projectId"] == a.as_str()),
        "feed for project {a} leaked other projects: {:?}",
        rows.iter().map(|r| r["projectId"].clone()).collect::<Vec<_>>()
    );
    // `total` drives pagination, so it must count the project's rows, not the table's.
    assert_eq!(feed["total"].as_u64().unwrap() as usize, rows.len(), "total counts only this project");
}

/// The entity feed must still work when the entity id is not an integer.
///
/// OWNERSHIP rows carry a *user* id (`usrB1786485885569204744`), not a pid. The
/// project feed's predicate parses its id as i64, and copying that trick here —
/// or writing a validator that only accepts digits — silently returns an empty
/// history for every ownership transfer instead of failing loudly.
#[tokio::test]
async fn entity_feed_handles_non_numeric_entity_id() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let heir = mk_user(&store).await;
    let to = token(&owner);

    let pid = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("O{}", uniq()) })).await["id"].as_str().unwrap().to_string();
    ok(&router, &format!("{PROJECT}/AddProjectMember"), &to, json!({ "projectId": pid, "userId": heir })).await;
    ok(&router, &format!("{PROJECT}/TransferProjectOwnership"), &to, json!({ "id": pid, "newOwnerId": heir })).await;

    // entity_id here is the new owner's user id — letters and all.
    let feed = ok(&router, &format!("{ACT}/ListEntityActivity"), &to, json!({ "entityType": "OWNERSHIP", "entityId": heir })).await;
    let rows = feed["activities"].as_array().unwrap();
    assert!(!rows.is_empty(), "ownership feed for user id {heir} must not be empty");
    assert!(rows.iter().all(|r| r["entityId"] == heir.as_str()), "feed leaked other entities: {rows:?}");
    assert!(rows.iter().all(|r| r["entityType"] == "OWNERSHIP"), "feed leaked other entity types: {rows:?}");
}

/// The recent feed selects its page in SQL, so paging and `total` must still
/// agree: `total` counts every matching row (not the page), consecutive pages do
/// not overlap, and rows come back newest-first.
#[tokio::test]
async fn recent_feed_pages_in_sql_without_overlap() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);

    // One project, several activity rows, all belonging to this fresh user.
    let pid = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("R{}", uniq()) })).await["id"].as_str().unwrap().to_string();
    for i in 0..5 {
        ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": pid, "name": format!("M{i}") })).await;
    }

    let p1 = ok(&router, &format!("{ACT}/ListRecentActivity"), &to, json!({ "page": 1, "pageSize": 2 })).await;
    let p2 = ok(&router, &format!("{ACT}/ListRecentActivity"), &to, json!({ "page": 2, "pageSize": 2 })).await;
    let total = p1["total"].as_u64().unwrap();

    let ids = |v: &Value| -> Vec<String> {
        v["activities"].as_array().unwrap().iter().map(|a| a["id"].as_str().unwrap().to_string()).collect()
    };
    let (a, b) = (ids(&p1), ids(&p2));
    assert_eq!(a.len(), 2, "page 1 holds exactly pageSize rows");
    // `total` must be the unpaged count, NOT the page length — the bug this guards
    // is re-paging an already-paged result and reporting the page as the total.
    // 5 modules => 5 rows. Creating the project itself records nothing: the
    // recorded entity types are MODULE/TASK/PAGE/MEMBERSHIP/OWNERSHIP, not PROJECT.
    assert_eq!(total, 5, "total counts all matching rows, not the page");
    assert_eq!(p2["total"].as_u64().unwrap(), total, "total is stable across pages");
    assert!(a.iter().all(|x| !b.contains(x)), "pages overlap: {a:?} vs {b:?}");

    // Newest-first, across the page boundary too.
    let times: Vec<&str> = p1["activities"].as_array().unwrap().iter().chain(p2["activities"].as_array().unwrap())
        .map(|x| x["createdAt"].as_str().unwrap()).collect();
    assert!(times.windows(2).all(|w| w[0] >= w[1]), "not newest-first: {times:?}");

    // Scoping still holds: this user only sees their own project's rows.
    assert!(p1["activities"].as_array().unwrap().iter().all(|x| x["projectId"] == pid.as_str()));
}
