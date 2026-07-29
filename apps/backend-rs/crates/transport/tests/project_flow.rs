//! End-to-end ProjectService (create + list/detail + authority) over the real
//! Connect router + Postgres. Skipped unless `DATABASE_URL` is set. Uses unique
//! user/project ids so reruns on the persistent per-op DB stay isolated.

use std::sync::Arc;

use auth::{sign_jwt, verify_jwt};
use axum::body::{to_bytes, Body};
use axum::extract::Request;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::StatusCode;
use axum::middleware::{from_fn, Next};
use axum::response::Response;
use axum::Router;
use domain::project::ProjectMembership;
use persistence::Store;
use serde_json::{json, Value};
use tower::ServiceExt;

const SECRET: &str = "test-secret";
const SVC: &str = "/sedjiwa.tasks.project.v1.ProjectService";

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
    let store = Arc::new(Store::connect(&url, domain::register_all).await.unwrap());
    let router = transport::project_router(store.clone()).layer(from_fn(auth_mw));
    Some((router, store))
}

fn user_token(sub: &str) -> String {
    sign_jwt(SECRET, sub, &["projects:create".to_string()], 9_999_999_999).unwrap()
}
fn admin_token(sub: &str) -> String {
    sign_jwt(SECRET, sub, &["*".to_string()], 9_999_999_999).unwrap()
}

async fn call(router: &Router, rpc: &str, token: Option<&str>, body: Value) -> (StatusCode, Value) {
    let mut b = Request::builder()
        .method("POST")
        .uri(format!("{SVC}/{rpc}"))
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

async fn create(router: &Router, token: &str, body: Value) -> String {
    let (st, body) = call(router, "CreateProject", Some(token), body).await;
    assert_eq!(st, StatusCode::OK, "create: {body}");
    body["id"].as_str().unwrap().to_string()
}

/// Member `user_id`s for a project id.
async fn members(store: &Store, project_id: &str) -> Vec<String> {
    let pid = project_id.to_string();
    let mut v = store
        .query::<ProjectMembership, String>(None, move |world, pairs| {
            pairs
                .iter()
                .filter_map(|(_, e)| world.get::<ProjectMembership>(*e))
                .filter(|m| m.project_id == pid)
                .map(|m| m.user_id.clone())
                .collect()
        })
        .await
        .unwrap();
    v.sort();
    v
}

fn list_ids(body: &Value) -> Vec<String> {
    body["projects"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|p| p["id"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn create_default_owner_and_membership() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let a = format!("usrA{}", uniq());
    let (st, body) = call(
        &router,
        "CreateProject",
        Some(&user_token(&a)),
        json!({ "name": "  Website Revamp  ", "description": "landing" }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "create: {body}");
    assert_eq!(body["name"], "Website Revamp");
    assert_eq!(body["ownerId"], a);
    assert_eq!(body["description"], "landing");
    assert_eq!(body["status"], "PROJECT_STATUS_ACTIVE");
    let id = body["id"].as_str().unwrap();
    assert_eq!(members(&store, id).await, vec![a]);
}

#[tokio::test]
async fn list_is_member_scoped_with_filters() {
    let Some((router, _store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let a = format!("usrA{}", uniq());
    let b = format!("usrB{}", uniq());
    let ta = user_token(&a);
    let name1 = format!("Alpha{}", uniq());
    let name2 = format!("Beta{}", uniq());
    let p1 = create(&router, &ta, json!({ "name": name1 })).await;
    let p2 = create(&router, &ta, json!({ "name": name2 })).await;
    let p3 = create(&router, &user_token(&b), json!({ "name": "Gamma" })).await;

    // A sees only their projects (member-scoped), not B's.
    let (st, body) = call(&router, "ListProjects", Some(&ta), json!({})).await;
    assert_eq!(st, StatusCode::OK, "list: {body}");
    let mut ids = list_ids(&body);
    ids.sort();
    let mut want = vec![p1.clone(), p2.clone()];
    want.sort();
    assert_eq!(ids, want, "A is member of exactly P1,P2");
    assert_eq!(body["total"], 2);
    assert!(!ids.contains(&p3), "A must not see B's project");

    // Complete P2, then filter by status.
    let (st, _) = call(
        &router,
        "SetProjectStatus",
        Some(&ta),
        json!({ "id": p2, "status": "PROJECT_STATUS_COMPLETED" }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (_, body) = call(
        &router,
        "ListProjects",
        Some(&ta),
        json!({ "status": ["PROJECT_STATUS_ACTIVE"] }),
    )
    .await;
    assert_eq!(list_ids(&body), vec![p1.clone()], "active filter → only P1");
    let (_, body) = call(
        &router,
        "ListProjects",
        Some(&ta),
        json!({ "status": ["PROJECT_STATUS_COMPLETED"] }),
    )
    .await;
    assert_eq!(list_ids(&body), vec![p2.clone()], "completed filter → only P2");

    // Search by unique name.
    let (_, body) = call(
        &router,
        "ListProjects",
        Some(&ta),
        json!({ "search": name1 }),
    )
    .await;
    assert_eq!(list_ids(&body), vec![p1.clone()]);

    // Admin sees B's project too (via search to avoid pagination noise).
    let adm = admin_token(&format!("adm{}", uniq()));
    let (_, body) = call(&router, "ListProjects", Some(&adm), json!({ "search": "Gamma" })).await;
    assert!(list_ids(&body).contains(&p3), "admin sees all");
}

#[tokio::test]
async fn get_project_member_gated() {
    let Some((router, _store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let a = format!("usrA{}", uniq());
    let b = format!("usrB{}", uniq());
    let id = create(&router, &user_token(&a), json!({ "name": "Secret" })).await;

    // Owner/member A → ok.
    let (st, _) = call(&router, "GetProject", Some(&user_token(&a)), json!({ "id": id })).await;
    assert_eq!(st, StatusCode::OK);
    // Non-member B → denied.
    let (st, _) = call(&router, "GetProject", Some(&user_token(&b)), json!({ "id": id })).await;
    assert_ne!(st, StatusCode::OK, "non-member must be denied");
    // Admin → ok even if not a member.
    let (st, _) = call(
        &router,
        "GetProject",
        Some(&admin_token(&format!("adm{}", uniq()))),
        json!({ "id": id }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "admin bypasses membership");
    // Unknown id → not found; unauthenticated → rejected.
    let (st, _) = call(&router, "GetProject", Some(&user_token(&a)), json!({ "id": "99999999" })).await;
    assert_ne!(st, StatusCode::OK);
    let (st, _) = call(&router, "GetProject", None, json!({ "id": id })).await;
    assert_ne!(st, StatusCode::OK);
}

#[tokio::test]
async fn authority_status_transfer_delete() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let a = format!("usrA{}", uniq());
    let b = format!("usrB{}", uniq());
    let id = create(&router, &user_token(&a), json!({ "name": "Ops" })).await;

    // Non-owner B cannot change status; UNSPECIFIED rejected; owner A can.
    let (st, _) = call(
        &router,
        "SetProjectStatus",
        Some(&user_token(&b)),
        json!({ "id": id, "status": "PROJECT_STATUS_COMPLETED" }),
    )
    .await;
    assert_ne!(st, StatusCode::OK, "non-owner denied");
    let (st, _) = call(
        &router,
        "SetProjectStatus",
        Some(&user_token(&a)),
        json!({ "id": id, "status": "PROJECT_STATUS_UNSPECIFIED" }),
    )
    .await;
    assert_ne!(st, StatusCode::OK, "unspecified rejected");
    let (st, body) = call(
        &router,
        "SetProjectStatus",
        Some(&user_token(&a)),
        json!({ "id": id, "status": "PROJECT_STATUS_ARCHIVED" }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["status"], "PROJECT_STATUS_ARCHIVED");

    // Transfer A → B: owner becomes B, B is now a member.
    let (st, body) = call(
        &router,
        "TransferProjectOwnership",
        Some(&user_token(&a)),
        json!({ "id": id, "newOwnerId": b }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "transfer: {body}");
    assert_eq!(body["ownerId"], b);
    let mut mem = members(&store, &id).await;
    mem.sort();
    let mut want = vec![a.clone(), b.clone()];
    want.sort();
    assert_eq!(mem, want, "old + new owner are members");

    // A is no longer owner → cannot set status.
    let (st, _) = call(
        &router,
        "SetProjectStatus",
        Some(&user_token(&a)),
        json!({ "id": id, "status": "PROJECT_STATUS_ACTIVE" }),
    )
    .await;
    assert_ne!(st, StatusCode::OK, "former owner loses authority");

    // New owner B deletes → project gone, memberships cleared.
    let (st, _) = call(&router, "DeleteProject", Some(&user_token(&b)), json!({ "id": id })).await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = call(&router, "GetProject", Some(&admin_token(&format!("adm{}", uniq()))), json!({ "id": id })).await;
    assert_ne!(st, StatusCode::OK, "deleted project is gone");
    assert!(members(&store, &id).await.is_empty(), "memberships cleared");
}
