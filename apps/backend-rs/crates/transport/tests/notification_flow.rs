//! End-to-end notifications: emits from other services persist + are queryable,
//! scoped to the recipient. Skipped unless `DATABASE_URL` is set.

use std::collections::HashSet;
use std::sync::Arc;

use auth::{sign_jwt, verify_jwt};
use axum::body::{to_bytes, Body};
use axum::extract::Request;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::StatusCode;
use axum::middleware::{from_fn, Next};
use axum::response::Response;
use axum::{Extension, Router};
use domain::user::{UserPassword, UserPhone, UserProfile, UserStatusComponent};
use persistence::Store;
use serde_json::{json, Value};
use tower::ServiceExt;
use transport::Notifier;

const SECRET: &str = "test-secret";
const PROJECT: &str = "/sedjiwa.tasks.project.v1.ProjectService";
const MODULE: &str = "/sedjiwa.tasks.work.v1.ModuleService";
const TASK: &str = "/sedjiwa.tasks.work.v1.TaskService";
const COMMENT: &str = "/sedjiwa.tasks.comment.v1.CommentService";
const NOTIF: &str = "/sedjiwa.tasks.notification.v1.NotificationService";

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
    let notifier = Arc::new(Notifier::new());
    let router = transport::project_router(store.clone())
        .merge(transport::module_router(store.clone()))
        .merge(transport::task_router(store.clone()))
        .merge(transport::comment_router(store.clone()))
        .merge(transport::notification_router(store.clone(), notifier.clone()))
        .layer(Extension(notifier)) // global, so mutating handlers can emit
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

fn types(body: &Value) -> HashSet<String> {
    body["notifications"].as_array().cloned().unwrap_or_default().iter().map(|n| n["type"].as_str().unwrap().to_string()).collect()
}

/// Numeric field, defaulting to 0 (proto3 JSON omits zero-valued scalars).
fn num(body: &Value, key: &str) -> u64 {
    body[key].as_u64().unwrap_or(0)
}

#[tokio::test]
async fn emits_are_scoped_and_markable() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let actor = mk_user(&store).await; // creates task/comment
    let recipient = mk_user(&store).await;
    let (to, ta, tr) = (token(&owner), token(&actor), token(&recipient));

    // AddProjectMember → ProjectMemberAdded to actor + recipient (actor=owner).
    let p = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("P{}", uniq()) })).await;
    let pid = p["id"].as_str().unwrap().to_string();
    ok(&router, &format!("{PROJECT}/AddProjectMember"), &to, json!({ "projectId": pid, "userId": actor })).await;
    ok(&router, &format!("{PROJECT}/AddProjectMember"), &to, json!({ "projectId": pid, "userId": recipient })).await;

    // A module + a task assigned to recipient (actor=actor) → TaskAssigned.
    let m = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": pid, "name": "M" })).await["id"].as_str().unwrap().to_string();
    let task = ok(&router, &format!("{TASK}/CreateTask"), &ta, json!({ "moduleId": m, "title": "T", "assigneeIds": [recipient] })).await["id"].as_str().unwrap().to_string();

    // Comment mentioning recipient (→ Mention) and one mentioning self (→ no-op).
    ok(&router, &format!("{COMMENT}/CreateComment"), &ta, json!({ "taskId": task, "content": "hi", "mentionedUserIds": [recipient] })).await;
    ok(&router, &format!("{COMMENT}/CreateComment"), &ta, json!({ "taskId": task, "content": "self", "mentionedUserIds": [actor] })).await;

    // Recipient sees exactly 3 notifications of the right kinds, newest-first.
    let list = ok(&router, &format!("{NOTIF}/ListNotifications"), &tr, json!({})).await;
    assert_eq!(num(&list, "total"), 3, "recipient got 3 notifications: {list}");
    assert_eq!(
        types(&list),
        ["PROJECT_MEMBER_ADDED", "TASK_ASSIGNED", "MENTION"].iter().map(|s| s.to_string()).collect(),
    );
    // Newest first: the last emit (Mention) is first.
    assert_eq!(list["notifications"][0]["type"], "MENTION");
    // proto3 omits false bools → absent means unread.
    assert!(!list["notifications"][0]["read"].as_bool().unwrap_or(false));

    // Unread count + mark one + mark all.
    let uc = ok(&router, &format!("{NOTIF}/UnreadCount"), &tr, json!({})).await;
    assert_eq!(num(&uc, "count"), 3);
    let first_id = list["notifications"][0]["id"].as_str().unwrap();
    ok(&router, &format!("{NOTIF}/MarkRead"), &tr, json!({ "ids": [first_id] })).await;
    assert_eq!(num(&ok(&router, &format!("{NOTIF}/UnreadCount"), &tr, json!({})).await, "count"), 2);
    ok(&router, &format!("{NOTIF}/MarkAllRead"), &tr, json!({})).await;
    assert_eq!(num(&ok(&router, &format!("{NOTIF}/UnreadCount"), &tr, json!({})).await, "count"), 0);

    // Scoping: the actor cannot mark the recipient's notification, and the owner
    // sees only their own (ProjectMemberAdded to owner? no — owner is the actor of
    // both adds, so owner has 0).
    let (st, _) = call(&router, &format!("{NOTIF}/MarkRead"), Some(&ta), json!({ "ids": [first_id] })).await;
    assert_eq!(st, StatusCode::OK, "mark-read of another's id is a silent no-op");
    let owner_list = ok(&router, &format!("{NOTIF}/ListNotifications"), &to, json!({})).await;
    assert_eq!(num(&owner_list, "total"), 0, "owner is the actor, not a recipient");

    // The self-mention produced no notification (recipient still totals 3).
    let again = ok(&router, &format!("{NOTIF}/ListNotifications"), &tr, json!({})).await;
    assert_eq!(num(&again, "total"), 3, "self-mention did not notify");
}
