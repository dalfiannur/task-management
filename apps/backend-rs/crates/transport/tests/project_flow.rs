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
use domain::user::{UserPassword, UserPhone, UserProfile, UserStatusComponent};
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

/// Create a real Active user directly; return its pid string (for member ops,
/// which validate the user exists).
async fn mk_user(store: &Store) -> String {
    let now = "2026-01-01T00:00:00Z".to_string();
    let pid = store
        .create((
            UserPhone {
                value: format!("m{}", uniq()),
                verified: true,
            },
            UserPassword {
                hash: "x".into(),
                changed_at: now.clone(),
            },
            UserProfile {
                display_name: "M".into(),
                avatar_url: String::new(),
                email: String::new(),
            },
            UserStatusComponent {
                status: "active".into(),
                created_at: now,
                last_login_at: None,
            },
        ))
        .await
        .unwrap();
    pid.to_string()
}

/// Sorted member user_ids from a ListProjectMembersResponse body.
fn member_users(body: &Value) -> Vec<String> {
    let mut v: Vec<String> = body["members"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|m| m["userId"].as_str().unwrap().to_string())
        .collect();
    v.sort();
    v
}

/// Whether `user_id` is flagged is_owner in the response.
fn is_owner_flag(body: &Value, user_id: &str) -> bool {
    body["members"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .find(|m| m["userId"] == user_id)
        .map(|m| m["isOwner"] == true)
        .unwrap_or(false)
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
    // Uniquified like its two siblings above. With a literal "Gamma" this test
    // was a time bomb against the persistent dev database: every run left
    // another "Gamma" behind, and once more than `DEFAULT_LIMIT` (12) had
    // accumulated, the search below returned a full first page of older rows
    // and this run's project fell off it.
    let name3 = format!("Gamma{}", uniq());
    let p3 = create(&router, &user_token(&b), json!({ "name": name3 })).await;

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
    let (_, body) = call(&router, "ListProjects", Some(&adm), json!({ "search": name3 })).await;
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

#[tokio::test]
async fn members_list_add_remove_leave() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let a = mk_user(&store).await; // owner
    let b = mk_user(&store).await;
    let c = mk_user(&store).await; // outsider
    let (ta, tb, tc) = (user_token(&a), user_token(&b), user_token(&c));
    let id = create(&router, &ta, json!({ "name": "Team" })).await;

    // List as owner → [A owner].
    let (st, body) = call(&router, "ListProjectMembers", Some(&ta), json!({ "projectId": id })).await;
    assert_eq!(st, StatusCode::OK, "list members: {body}");
    assert_eq!(body["ownerId"], a);
    assert_eq!(member_users(&body), vec![a.clone()]);
    assert!(is_owner_flag(&body, &a), "A is owner");

    // Non-member C denied.
    let (st, _) = call(&router, "ListProjectMembers", Some(&tc), json!({ "projectId": id })).await;
    assert_ne!(st, StatusCode::OK, "non-member cannot list");

    // Add B (as owner) → {A,B}; B not owner; idempotent.
    let (st, body) = call(&router, "AddProjectMember", Some(&ta), json!({ "projectId": id, "userId": b })).await;
    assert_eq!(st, StatusCode::OK, "add: {body}");
    let mut want = vec![a.clone(), b.clone()]; want.sort();
    assert_eq!(member_users(&body), want);
    assert!(!is_owner_flag(&body, &b), "B is not owner");
    let (st, body) = call(&router, "AddProjectMember", Some(&ta), json!({ "projectId": id, "userId": b })).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(member_users(&body).len(), 2, "add is idempotent");

    // Add nonexistent user → not found.
    let (st, _) = call(&router, "AddProjectMember", Some(&ta), json!({ "projectId": id, "userId": "99999999" })).await;
    assert_ne!(st, StatusCode::OK, "unknown user rejected");

    // B (member) can list; B (non-owner) cannot add.
    let (st, _) = call(&router, "ListProjectMembers", Some(&tb), json!({ "projectId": id })).await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = call(&router, "AddProjectMember", Some(&tb), json!({ "projectId": id, "userId": c })).await;
    assert_ne!(st, StatusCode::OK, "non-owner cannot add");

    // Cannot remove owner; remove B → {A}; remove non-member is no-op success.
    let (st, _) = call(&router, "RemoveProjectMember", Some(&ta), json!({ "projectId": id, "userId": a })).await;
    assert_ne!(st, StatusCode::OK, "cannot remove owner");
    let (st, body) = call(&router, "RemoveProjectMember", Some(&ta), json!({ "projectId": id, "userId": b })).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(member_users(&body), vec![a.clone()]);
    let (st, _) = call(&router, "RemoveProjectMember", Some(&ta), json!({ "projectId": id, "userId": b })).await;
    assert_eq!(st, StatusCode::OK, "removing non-member is a no-op success");

    // Owner cannot leave; a member can; non-member cannot.
    let (st, _) = call(&router, "LeaveProject", Some(&ta), json!({ "projectId": id })).await;
    assert_ne!(st, StatusCode::OK, "owner cannot leave");
    let _ = call(&router, "AddProjectMember", Some(&ta), json!({ "projectId": id, "userId": b })).await;
    let (st, _) = call(&router, "LeaveProject", Some(&tb), json!({ "projectId": id })).await;
    assert_eq!(st, StatusCode::OK, "member can leave");
    assert_eq!(members(&store, &id).await, vec![a.clone()], "only owner remains");
    let (st, _) = call(&router, "LeaveProject", Some(&tc), json!({ "projectId": id })).await;
    assert_ne!(st, StatusCode::OK, "non-member cannot leave");
}
