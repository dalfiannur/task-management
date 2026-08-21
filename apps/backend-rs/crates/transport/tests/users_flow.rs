//! End-to-end Users/Auth flow over the real Connect routers + Postgres.
//! Skipped unless `DATABASE_URL` is set. Drives the router with `tower::oneshot`
//! and Connect JSON bodies.

use std::sync::Arc;

use auth::{hash_password, sign_jwt, verify_jwt, AuthUser};
use axum::body::{to_bytes, Body};
use axum::extract::Request;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::StatusCode;
use axum::middleware::{from_fn, Next};
use axum::response::Response;
use axum::Router;
use domain::user::{AdminMark, UserPassword, UserPhone, UserProfile, UserStatusComponent};
use persistence::Store;
use serde_json::{json, Value};
use tower::ServiceExt;
use transport::JwtConfig;

const SECRET: &str = "test-secret";

/// Test-side JWT extraction (mirrors app::interceptor::auth_layer).
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
    let jwt = Arc::new(JwtConfig {
        secret: SECRET.into(),
        ttl_secs: 3_600,
    });
    let router = transport::auth_router(store.clone(), jwt)
        .merge(transport::user_router(store.clone()))
        .layer(from_fn(auth_mw));
    Some((router, store))
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
    let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, value)
}

/// Create an Active admin directly in the store; return a bearer token for it.
async fn seed_admin(store: &Store, phone: &str) -> String {
    let now = "2026-01-01T00:00:00Z".to_string();
    let pid = store
        .create((
            UserPhone {
                value: phone.into(),
                verified: true,
            },
            UserPassword {
                hash: hash_password("adminpass").unwrap(),
                changed_at: now.clone(),
            },
            UserProfile {
                display_name: "Admin".into(),
                avatar_url: String::new(),
                email: String::new(),
            },
            UserStatusComponent {
                status: "active".into(),
                created_at: now.clone(),
                last_login_at: None,
            },
        ))
        .await
        .unwrap();
    store
        .update(pid, move |w, e| {
            w.insert(e, AdminMark { granted_at: now });
        })
        .await
        .unwrap();
    let admin: AuthUser = AuthUser {
        id: pid.to_string(),
        permissions: vec!["*".into()],
    };
    sign_jwt(SECRET, &admin.id, &admin.permissions, 9_999_999_999).unwrap()
}

const AUTH: &str = "/sedjiwa.tasks.auth.v1.AuthService";
const DIR: &str = "/sedjiwa.tasks.auth.v1.UserDirectoryService";

/// Unique suffix so reruns on a persistent DB don't collide on the phone unique
/// index (the per-op Store never wipes).
fn uniq() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos()
        .to_string()
}

#[tokio::test]
async fn register_approve_login_me_and_change_password() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let admin_token = seed_admin(&store, &format!("admin-{}", uniq())).await;
    let phone_owned = format!("0811{}", uniq());
    let phone = phone_owned.as_str();

    // 1) Register → 200, status Pending, no token.
    let (st, body) = call(
        &router,
        &format!("{AUTH}/Register"),
        None,
        json!({ "phone": phone, "password": "sekret123", "displayName": "Alice" }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "register: {body}");
    let user_id = body["id"].as_str().unwrap().to_string();
    assert_eq!(body["phone"], phone);

    // 2) Login while Pending → error (not 200).
    let (st, _) = call(
        &router,
        &format!("{AUTH}/Login"),
        None,
        json!({ "phone": phone, "password": "sekret123" }),
    )
    .await;
    assert_ne!(st, StatusCode::OK, "pending login must be rejected");

    // 3) Admin activates.
    let (st, _) = call(
        &router,
        &format!("{DIR}/ActivateUser"),
        Some(&admin_token),
        json!({ "id": user_id }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "activate must succeed");

    // 4) Login now succeeds → token.
    let (st, body) = call(
        &router,
        &format!("{AUTH}/Login"),
        None,
        json!({ "phone": phone, "password": "sekret123" }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "active login: {body}");
    let token = body["token"].as_str().unwrap().to_string();
    assert!(!token.is_empty());

    // 5) Me(token) → the user.
    let (st, body) = call(&router, &format!("{AUTH}/Me"), Some(&token), json!({})).await;
    assert_eq!(st, StatusCode::OK, "me: {body}");
    assert_eq!(body["phone"], phone);
    assert_eq!(body["id"], user_id);

    // 6) SearchUsers (as the active user) finds Alice.
    let (st, body) = call(
        &router,
        &format!("{DIR}/SearchUsers"),
        Some(&token),
        json!({ "q": "Alice" }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "search: {body}");
    let users = body["users"].as_array().cloned().unwrap_or_default();
    assert!(users.iter().any(|u| u["phone"] == phone));

    // 7) Change password, then login with the new one.
    let (st, _) = call(
        &router,
        &format!("{AUTH}/ChangeMyPassword"),
        Some(&token),
        json!({ "currentPassword": "sekret123", "newPassword": "newsekret456" }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "change password");
    let (st, _) = call(
        &router,
        &format!("{AUTH}/Login"),
        None,
        json!({ "phone": phone, "password": "newsekret456" }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "login with new password");

    // Old password now fails.
    let (st, _) = call(
        &router,
        &format!("{AUTH}/Login"),
        None,
        json!({ "phone": phone, "password": "sekret123" }),
    )
    .await;
    assert_ne!(st, StatusCode::OK, "old password must fail");
}

#[tokio::test]
async fn non_admin_cannot_activate_and_duplicate_phone_rejected() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let _ = seed_admin(&store, &format!("admin-{}", uniq())).await;
    let phone_owned = format!("0811{}", uniq());
    let phone = phone_owned.as_str();

    // Register once → ok; twice → already exists (non-200).
    let (st, _) = call(
        &router,
        &format!("{AUTH}/Register"),
        None,
        json!({ "phone": phone, "password": "sekret123", "displayName": "Bob" }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = call(
        &router,
        &format!("{AUTH}/Register"),
        None,
        json!({ "phone": phone, "password": "sekret123", "displayName": "Bob2" }),
    )
    .await;
    assert_ne!(st, StatusCode::OK, "duplicate phone must be rejected");

    // A non-admin (unauthenticated) cannot activate.
    let (st, _) = call(
        &router,
        &format!("{DIR}/ActivateUser"),
        None,
        json!({ "id": "1" }),
    )
    .await;
    assert_ne!(st, StatusCode::OK, "unauthenticated activate must be rejected");
}

/// An admin must not be able to act on their own account. Suspending yourself,
/// revoking your own admin mark, or deleting yourself each destroy the very
/// permission needed to undo them — and with a single admin, the normal case,
/// that locks the instance out of user management for good.
#[tokio::test]
async fn admin_cannot_suspend_demote_or_delete_self() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let token = seed_admin(&store, &format!("admin-{}", uniq())).await;
    let me = verify_jwt(&token, SECRET).unwrap().id;

    for (rpc, body) in [
        ("SuspendUser", json!({ "id": &me })),
        ("SetAdmin", json!({ "id": &me, "isAdmin": false })),
        ("DeleteUser", json!({ "id": &me })),
    ] {
        let (st, _) = call(&router, &format!("{DIR}/{rpc}"), Some(&token), body).await;
        assert_eq!(
            st,
            StatusCode::BAD_REQUEST,
            "{rpc} against one's own account must be refused"
        );
    }

    // The guard has to reject before any write lands, not merely report an
    // error afterwards — so re-read and prove nothing moved.
    let (st, v) = call(
        &router,
        &format!("{DIR}/GetUser"),
        Some(&token),
        json!({ "id": &me }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "the admin must still exist");
    assert_eq!(v["isAdmin"], json!(true), "admin mark must survive");
    assert_eq!(v["status"], json!("ACTIVE"), "status must survive");
}

/// The same three actions aimed at somebody else still work — the guard must
/// block self-targeting only, not the feature.
#[tokio::test]
async fn admin_can_still_suspend_and_demote_another_admin() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let token = seed_admin(&store, &format!("admin-{}", uniq())).await;
    let other_token = seed_admin(&store, &format!("admin2-{}", uniq())).await;
    let other = verify_jwt(&other_token, SECRET).unwrap().id;

    // Read first, so the demotion below is measured against a known `true`.
    // Proto3 JSON omits default-valued scalars, so a demoted user comes back
    // with no `isAdmin` key at all rather than `false` — asserting equality
    // with `false` would fail on a correct demotion.
    let (st, v) = call(
        &router,
        &format!("{DIR}/GetUser"),
        Some(&token),
        json!({ "id": &other }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(v["isAdmin"], json!(true), "seeded as an admin");

    let (st, v) = call(
        &router,
        &format!("{DIR}/SetAdmin"),
        Some(&token),
        json!({ "id": &other, "isAdmin": false }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_ne!(v["isAdmin"], json!(true), "the other admin was demoted");

    let (st, v) = call(
        &router,
        &format!("{DIR}/SuspendUser"),
        Some(&token),
        json!({ "id": &other }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(v["status"], json!("SUSPENDED"));
}

/// ListUsers pages in SQL, so the page must actually narrow what comes back
/// while `total` keeps describing the whole matching set.
///
/// Assertions are relative, never absolute counts: the flow tests share one
/// database across reruns and other tests seed users of their own, so any
/// "exactly N users exist" claim would rot on the second run.
#[tokio::test]
async fn list_users_pages_in_sql_and_reports_the_unpaged_total() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let token = seed_admin(&store, &format!("admin-{}", uniq())).await;

    // Five fresh registrations, so at least five users exist whatever else the
    // database already holds.
    for i in 0..5 {
        let (st, _) = call(
            &router,
            &format!("{AUTH}/Register"),
            None,
            json!({
                "phone": format!("08{}{}", i, uniq()),
                "password": "sekret123",
                "displayName": format!("Paged {i}"),
            }),
        )
        .await;
        assert_eq!(st, StatusCode::OK);
    }

    let page = |n: u32| {
        let token = token.clone();
        let router = router.clone();
        async move {
            let (st, v) = call(
                &router,
                &format!("{DIR}/ListUsers"),
                Some(&token),
                json!({ "page": n, "pageSize": 2 }),
            )
            .await;
            assert_eq!(st, StatusCode::OK);
            let ids: Vec<String> = v["users"]
                .as_array()
                .unwrap()
                .iter()
                .map(|u| u["id"].as_str().unwrap().to_string())
                .collect();
            let total = v["total"].as_u64().unwrap() as u32;
            (ids, total)
        }
    };

    let (first, total_1) = page(1).await;
    let (second, total_2) = page(2).await;

    assert_eq!(first.len(), 2, "pageSize must bound the page");
    assert_eq!(second.len(), 2);
    assert!(
        first.iter().all(|id| !second.contains(id)),
        "consecutive pages must not overlap: {first:?} vs {second:?}"
    );
    assert_eq!(total_1, total_2, "total must not depend on the page asked for");
    assert!(
        total_1 > 2,
        "total must count the whole match set, not the page"
    );
    assert!(total_1 >= 6, "the five registrations plus the admin");
}

/// The status filter and the page have to compose: filtering must not leak rows
/// of another status, and `total` must describe the filtered set, not the table.
#[tokio::test]
async fn list_users_filter_and_page_size_ceiling() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let token = seed_admin(&store, &format!("admin-{}", uniq())).await;
    let (st, _) = call(
        &router,
        &format!("{AUTH}/Register"),
        None,
        json!({ "phone": format!("089{}", uniq()), "password": "sekret123", "displayName": "Waiting" }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    let (st, v) = call(
        &router,
        &format!("{DIR}/ListUsers"),
        Some(&token),
        json!({ "status": "PENDING", "pageSize": 50 }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let users = v["users"].as_array().unwrap();
    assert!(!users.is_empty(), "the registration above is pending");
    assert!(
        users.iter().all(|u| u["status"] == json!("PENDING")),
        "the filter must not leak other statuses"
    );

    // Newest first: created_at must not increase down the page.
    let created: Vec<&str> = users
        .iter()
        .map(|u| u["createdAt"].as_str().unwrap())
        .collect();
    let mut sorted = created.clone();
    sorted.sort_by(|a, b| b.cmp(a));
    assert_eq!(created, sorted, "page must be newest-registration first");

    // A page size past the ceiling is clamped, not honoured.
    let (st, v) = call(
        &router,
        &format!("{DIR}/ListUsers"),
        Some(&token),
        json!({ "pageSize": 9999 }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert!(
        v["users"].as_array().unwrap().len() <= 50,
        "page size must be clamped to the server maximum"
    );

    // An unrecognised status is a bad request, not a silent "everyone".
    let (st, _) = call(
        &router,
        &format!("{DIR}/ListUsers"),
        Some(&token),
        json!({ "status": "USER_STATUS_UNSPECIFIED" }),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "unspecified status is refused");
}
