//! End-to-end SearchService over the real Connect router + Postgres.
//! Skipped unless `DATABASE_URL` is set. Nothing indexes real entities yet
//! (later tasks add those call sites), so this only proves the RPC itself is
//! real: guarded, quiet on an empty index, and inert against injection.

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
const PAGE: &str = "/sedjiwa.tasks.page.v1.PageService";
const USERS: &str = "/sedjiwa.tasks.auth.v1.UserDirectoryService";
const SEARCH: &str = "/sedjiwa.tasks.search.v1.SearchService";

fn uniq() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos()
        .to_string()
}

fn term() -> String {
    format!("zqx{}", uniq())
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
        .merge(transport::page_router(store.clone()))
        .merge(transport::search_router(store.clone()))
        .layer(from_fn(auth_mw));
    Some((router, store))
}

fn token(sub: &str) -> String {
    sign_jwt(SECRET, sub, &["projects:create".to_string()], 9_999_999_999).unwrap()
}

async fn call(
    router: &Router,
    path: &str,
    token: Option<&str>,
    body: Value,
) -> (StatusCode, Value) {
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
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
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
        .unwrap()
        .to_string()
}

async fn project_with(router: &Router, owner: &str, members: &[&str]) -> String {
    let p = ok(
        router,
        &format!("{PROJECT}/CreateProject"),
        &token(owner),
        json!({ "name": format!("P{}", uniq()) }),
    )
    .await;
    let id = p["id"].as_str().unwrap().to_string();
    for m in members {
        ok(
            router,
            &format!("{PROJECT}/AddProjectMember"),
            &token(owner),
            json!({ "projectId": id, "userId": m }),
        )
        .await;
    }
    id
}

async fn find(router: &Router, tok: &str, q: &str) -> Vec<Value> {
    let v = ok(router, &format!("{SEARCH}/Search"), tok, json!({ "q": q })).await;
    v["results"].as_array().cloned().unwrap_or_default()
}

async fn module_in(router: &Router, owner_tok: &str, project: &str) -> String {
    ok(
        router,
        &format!("{MODULE}/CreateModule"),
        owner_tok,
        json!({ "projectId": project, "name": "M" }),
    )
    .await["id"]
        .as_str()
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn search_is_guarded_and_quiet_on_an_empty_index() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let user = mk_user(&store).await;
    let tok = token(&user);

    // Unauthenticated calls are rejected.
    let (st, _) = call(
        &router,
        &format!("{SEARCH}/Search"),
        None,
        json!({ "q": "anything" }),
    )
    .await;
    assert_ne!(st, StatusCode::OK, "unauthenticated search is rejected");

    // A nonsense term matches nothing — nothing is indexed yet, and nothing
    // else in the DB contains it.
    let results = find(&router, &tok, &term()).await;
    assert!(results.is_empty(), "empty index yields no results");

    // Empty query short-circuits to an empty result set.
    let results = find(&router, &tok, "").await;
    assert!(results.is_empty(), "empty q yields no results");

    // Injection attempt is inert and the table survives for the next query.
    let results = find(&router, &tok, "'; DROP TABLE search_doc; --").await;
    assert!(results.is_empty(), "injection attempt matches nothing");
    let results = find(&router, &tok, &term()).await;
    assert!(
        results.is_empty(),
        "search_doc still exists after the injection attempt"
    );
}

#[tokio::test]
async fn task_is_indexed_on_create_update_and_delete() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let outsider = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[]).await;
    let to = token(&owner);
    let m = module_in(&router, &to, &pid).await;

    let t1 = term();
    let task = ok(
        &router,
        &format!("{TASK}/CreateTask"),
        &to,
        json!({
            "moduleId": m, "title": format!("Perbaiki {t1}"), "description": "<p>catatan</p>"
        }),
    )
    .await["id"]
        .as_str()
        .unwrap()
        .to_string();

    let hits = find(&router, &to, &t1).await;
    assert_eq!(hits.len(), 1, "created task is findable: {hits:?}");
    assert_eq!(hits[0]["kind"], "TASK");
    assert_eq!(hits[0]["id"], task);
    assert_eq!(hits[0]["projectId"], pid);

    let hits = find(&router, &token(&outsider), &t1).await;
    assert!(hits.is_empty(), "non-member sees nothing: {hits:?}");

    // An admin bypasses the membership filter, matching `list_projects`.
    let admin_tok = auth::sign_jwt(SECRET, &outsider, &["*".to_string()], 9_999_999_999).unwrap();
    let hits = find(&router, &admin_tok, &t1).await;
    assert_eq!(hits.len(), 1, "admin sees every project: {hits:?}");

    let t2 = term();
    ok(
        &router,
        &format!("{TASK}/UpdateTask"),
        &to,
        json!({ "id": task, "title": format!("Ganti {t2}") }),
    )
    .await;
    assert_eq!(find(&router, &to, &t2).await.len(), 1, "new title indexed");
    assert!(find(&router, &to, &t1).await.is_empty(), "old title gone");

    ok(
        &router,
        &format!("{TASK}/DeleteTask"),
        &to,
        json!({ "id": task }),
    )
    .await;
    assert!(find(&router, &to, &t2).await.is_empty(), "deleted task gone");
}

#[tokio::test]
async fn page_is_indexed_on_create_update_and_delete() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[]).await;
    let to = token(&owner);

    let page = ok(
        &router,
        &format!("{PAGE}/CreatePage"),
        &to,
        json!({ "projectId": pid }),
    )
    .await["id"]
        .as_str()
        .unwrap()
        .to_string();

    let t = term();
    ok(
        &router,
        &format!("{PAGE}/UpdatePage"),
        &to,
        json!({
            "id": page, "title": format!("Alur {t}"), "content": "<p>langkah pertama</p>"
        }),
    )
    .await;

    let hits = find(&router, &to, &t).await;
    assert_eq!(hits.len(), 1, "page findable by title: {hits:?}");
    assert_eq!(hits[0]["kind"], "PAGE");
    assert_eq!(hits[0]["id"], page);

    let t2 = term();
    ok(
        &router,
        &format!("{PAGE}/UpdatePage"),
        &to,
        json!({
            "id": page, "content": format!("<p>isi {t2} di sini</p>")
        }),
    )
    .await;
    assert_eq!(find(&router, &to, &t2).await.len(), 1, "page body indexed");

    ok(
        &router,
        &format!("{PAGE}/DeletePage"),
        &to,
        json!({ "id": page }),
    )
    .await;
    assert!(find(&router, &to, &t2).await.is_empty(), "deleted page gone");
}

#[tokio::test]
async fn comment_is_indexed_and_carries_its_task() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let outsider = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[]).await;
    let to = token(&owner);
    let m = module_in(&router, &to, &pid).await;
    let task = ok(
        &router,
        &format!("{TASK}/CreateTask"),
        &to,
        json!({ "moduleId": m, "title": "T" }),
    )
    .await["id"]
        .as_str()
        .unwrap()
        .to_string();

    let t = term();
    let cid = ok(
        &router,
        &format!("{COMMENT}/CreateComment"),
        &to,
        json!({
            "taskId": task, "content": format!("<p>gagal karena {t}</p>")
        }),
    )
    .await["id"]
        .as_str()
        .unwrap()
        .to_string();

    let hits = find(&router, &to, &t).await;
    assert_eq!(hits.len(), 1, "comment findable: {hits:?}");
    assert_eq!(hits[0]["kind"], "COMMENT");
    assert_eq!(hits[0]["id"], cid);
    assert_eq!(hits[0]["taskId"], task, "comment result carries its parent task");
    // The stored body must be the `plain_text` projection, not raw HTML: the
    // source `<p>` wrapper must not survive into the index. `ts_headline`
    // itself is expected to add its own `<b>` highlight marks around the
    // matched term (see search.proto's `snippet` field comment and the
    // design doc) — those are not a sign of unsanitized markup, so this
    // checks for the specific source tag rather than for any `<` at all.
    let snippet = hits[0]["snippet"].as_str().unwrap();
    assert!(
        !snippet.contains("<p>") && !snippet.contains("</p>"),
        "snippet is the plain_text projection, not raw markup: {snippet:?}"
    );

    assert!(
        find(&router, &token(&outsider), &t).await.is_empty(),
        "non-member sees nothing"
    );

    ok(
        &router,
        &format!("{COMMENT}/DeleteComment"),
        &to,
        json!({ "id": cid }),
    )
    .await;
    assert!(find(&router, &to, &t).await.is_empty(), "deleted comment gone");
}
