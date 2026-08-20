//! End-to-end ExportService over the real Connect routers + Postgres.
//! Skipped unless `DATABASE_URL` is set (same convention as the other flow tests).

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
const EXPORT: &str = "/sedjiwa.tasks.export.v1.ExportService";
const LABEL: &str = "/sedjiwa.tasks.label.v1.LabelService";

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
        .merge(transport::label_router(store.clone()))
        .merge(transport::export_router(store.clone()))
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

async fn mk_user(store: &Store, name: &str) -> String {
    let now = "2026-01-01T00:00:00Z".to_string();
    store
        .create((
            UserPhone { value: format!("x{}", uniq()), verified: true },
            UserPassword { hash: "x".into(), changed_at: now.clone() },
            UserProfile { display_name: name.into(), avatar_url: String::new(), email: String::new() },
            UserStatusComponent { status: "active".into(), created_at: now, last_login_at: None },
        ))
        .await
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn csv_export_is_owner_gated_and_carries_task_rows() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store, "Rina").await;
    let member = mk_user(&store, "Budi").await;
    let (to, tm) = (token(&owner), token(&member));

    let project = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("Export {}", uniq()) })).await["id"]
        .as_str().unwrap().to_string();
    ok(&router, &format!("{PROJECT}/AddProjectMember"), &to, json!({ "projectId": project, "userId": member })).await;
    let module = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": project, "name": "Persiapan" })).await["id"]
        .as_str().unwrap().to_string();
    let label_name = format!("Genting-{}", uniq());
    let label = ok(&router, &format!("{LABEL}/CreateLabel"), &to,
        json!({ "projectId": project, "name": label_name, "color": "#ff0000" })).await["id"]
        .as_str().unwrap().to_string();
    ok(&router, &format!("{TASK}/CreateTask"), &to,
        json!({ "moduleId": module, "title": "Beli \"paku\", semen", "assigneeIds": [member], "labelIds": [label] })).await;

    // Member is refused: export is a consequential operation, not a read.
    let (st, _) = call(&router, &format!("{EXPORT}/ExportTasksCsv"), Some(&tm), json!({ "projectId": project })).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "member must not export");

    // No token at all is refused.
    let (st, _) = call(&router, &format!("{EXPORT}/ExportTasksCsv"), None, json!({ "projectId": project })).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED, "anonymous must not export");

    // Owner gets a CSV whose rows carry names, with the title properly quoted.
    let out = ok(&router, &format!("{EXPORT}/ExportTasksCsv"), &to, json!({ "projectId": project })).await;
    let csv = out["csv"].as_str().unwrap();
    assert!(out["fileName"].as_str().unwrap().ends_with("-tasks.csv"), "{out}");
    assert!(csv.starts_with("id,module,title,"), "header first: {csv}");
    assert!(csv.contains("\"Beli \"\"paku\"\", semen\""), "title quoted: {csv}");
    assert!(csv.contains("Persiapan"), "module by name: {csv}");
    assert!(csv.contains("Budi"), "assignee by name: {csv}");
    assert!(csv.contains(&label_name), "label by name, not silently dropped by gather: {csv}");
}

#[tokio::test]
async fn csv_export_of_a_foreign_project_is_not_found_or_denied() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store, "Rina").await;
    let outsider = mk_user(&store, "Asing").await;
    let project = ok(&router, &format!("{PROJECT}/CreateProject"), &token(&owner), json!({ "name": format!("Sunyi {}", uniq()) })).await["id"]
        .as_str().unwrap().to_string();

    let (st, _) = call(&router, &format!("{EXPORT}/ExportTasksCsv"), Some(&token(&outsider)), json!({ "projectId": project })).await;
    assert_eq!(st, StatusCode::FORBIDDEN, "a stranger must not export");

    let (st, _) = call(&router, &format!("{EXPORT}/ExportTasksCsv"), Some(&token(&owner)), json!({ "projectId": "999999999" })).await;
    assert_eq!(st, StatusCode::NOT_FOUND, "unknown project is refused, not empty-exported");
}
