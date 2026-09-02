//! End-to-end AccessTokenService lewat router Connect asli + Postgres.
//! Dilewati kecuali `DATABASE_URL` diset. Id unik agar rerun tetap terisolasi.

use std::sync::Arc;

use auth::{sign_jwt, verify_jwt};
use axum::body::{to_bytes, Body};
use axum::extract::Request;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::StatusCode;
use axum::middleware::{from_fn, Next};
use axum::response::Response;
use axum::Router;
use persistence::Store;
use serde_json::{json, Value};
use tower::ServiceExt;

const SECRET: &str = "test-secret";
const TOKENS: &str = "/sedjiwa.tasks.token.v1.AccessTokenService";

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
    let router = transport::token_router(store.clone()).layer(from_fn(auth_mw));
    Some((router, store))
}

fn uniq() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos().to_string()
}

fn token(sub: &str) -> String {
    sign_jwt(SECRET, sub, &[], 9_999_999_999).unwrap()
}

async fn call(router: &Router, path: &str, jwt: Option<&str>, body: Value) -> (StatusCode, Value) {
    let mut b = Request::builder().method("POST").uri(path).header(CONTENT_TYPE, "application/json");
    if let Some(t) = jwt {
        b = b.header(AUTHORIZATION, format!("Bearer {t}"));
    }
    let req = b.body(Body::from(body.to_string())).unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[tokio::test]
async fn create_list_revoke_round_trip() {
    let Some((router, _store)) = setup().await else { return };
    let user = format!("u-{}", uniq());
    let jwt = token(&user);

    let (st, created) = call(
        &router,
        &format!("{TOKENS}/CreateToken"),
        Some(&jwt),
        json!({ "name": "laptop", "expiresInDays": 0 }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{created:?}");
    let plaintext = created["token"].as_str().unwrap().to_string();
    assert!(plaintext.starts_with("sjw_pat_"));
    assert_eq!(created["accessToken"]["name"], "laptop");
    assert_eq!(created["accessToken"]["preview"], plaintext[plaintext.len() - 4..]);
    assert!(created["accessToken"]["expiresAt"].is_null());
    let id = created["accessToken"]["id"].as_str().unwrap().to_string();

    let (st, listed) = call(&router, &format!("{TOKENS}/ListTokens"), Some(&jwt), json!({})).await;
    assert_eq!(st, StatusCode::OK);
    let rows = listed["tokens"].as_array().unwrap();
    assert_eq!(rows.len(), 1);
    // Plaintext tidak pernah muncul lagi setelah pembuatan.
    assert!(rows[0].get("token").is_none());

    let (st, revoked) = call(
        &router,
        &format!("{TOKENS}/RevokeToken"),
        Some(&jwt),
        json!({ "id": id }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{revoked:?}");

    let (_, after) = call(&router, &format!("{TOKENS}/ListTokens"), Some(&jwt), json!({})).await;
    // proto3 JSON omits a repeated field entirely when it's empty, so an empty
    // list shows up as a missing `tokens` key rather than `[]`.
    assert!(after["tokens"].as_array().is_none_or(|a| a.is_empty()));
}

#[tokio::test]
async fn tokens_are_isolated_between_users() {
    let Some((router, _store)) = setup().await else { return };
    let owner = format!("u-{}", uniq());
    let other = format!("u-{}", uniq());

    let (_, created) = call(
        &router,
        &format!("{TOKENS}/CreateToken"),
        Some(&token(&owner)),
        json!({ "name": "mine", "expiresInDays": 30 }),
    )
    .await;
    let id = created["accessToken"]["id"].as_str().unwrap().to_string();
    assert!(created["accessToken"]["expiresAt"].is_string());

    // User lain tidak melihatnya… (`other` belum pernah membuat token, jadi
    // daftar kosongnya bahkan tidak membawa kunci `tokens` — lihat komentar
    // di `create_list_revoke_round_trip`.)
    let (_, listed) = call(&router, &format!("{TOKENS}/ListTokens"), Some(&token(&other)), json!({})).await;
    assert!(listed["tokens"]
        .as_array()
        .is_none_or(|a| a.iter().all(|t| t["id"] != id.as_str())));

    // …dan tidak bisa mencabutnya.
    let (st, _) = call(
        &router,
        &format!("{TOKENS}/RevokeToken"),
        Some(&token(&other)),
        json!({ "id": id }),
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn anonymous_is_refused() {
    let Some((router, _store)) = setup().await else { return };
    let (st, _) = call(&router, &format!("{TOKENS}/ListTokens"), None, json!({})).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn empty_name_is_rejected() {
    let Some((router, _store)) = setup().await else { return };
    let jwt = token(&format!("u-{}", uniq()));
    let (st, _) = call(
        &router,
        &format!("{TOKENS}/CreateToken"),
        Some(&jwt),
        json!({ "name": "", "expiresInDays": 0 }),
    )
    .await;
    // Nama kosong ditolak; `expires_in_days` bertipe uint32 sehingga nilai
    // negatif sudah mustahil sampai ke sini lewat proto.
    assert_eq!(st, StatusCode::BAD_REQUEST);
}
