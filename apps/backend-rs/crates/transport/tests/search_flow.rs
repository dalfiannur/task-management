//! End-to-end SearchService over the real Connect router + Postgres.
//! Skipped unless `DATABASE_URL` is set. Covers both the RPC itself (guarded,
//! quiet on an empty index, inert against injection) and the write-path
//! indexer call sites in each mutating service (tasks, pages, comments,
//! projects, people).

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
const AUTH: &str = "/sedjiwa.tasks.auth.v1.AuthService";
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
    let jwt = Arc::new(transport::JwtConfig {
        secret: SECRET.to_string(),
        ttl_secs: 3600,
    });
    let router = transport::project_router(store.clone())
        .merge(transport::module_router(store.clone()))
        .merge(transport::task_router(store.clone()))
        .merge(transport::comment_router(store.clone()))
        .merge(transport::page_router(store.clone()))
        .merge(transport::user_router(store.clone()))
        .merge(transport::auth_router(store.clone(), jwt))
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
async fn moved_task_stays_indexed_with_the_right_project() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[]).await;
    let to = token(&owner);
    let m1 = module_in(&router, &to, &pid).await;
    let m2 = module_in(&router, &to, &pid).await;

    let t = term();
    let task = ok(
        &router,
        &format!("{TASK}/CreateTask"),
        &to,
        json!({ "moduleId": m1, "title": format!("Pindahkan {t}") }),
    )
    .await["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(find(&router, &to, &t).await.len(), 1, "indexed at creation");

    ok(
        &router,
        &format!("{TASK}/MoveTask"),
        &to,
        json!({ "id": task, "moduleId": m2, "order": 0 }),
    )
    .await;

    let hits = find(&router, &to, &t).await;
    assert_eq!(hits.len(), 1, "still findable after the move: {hits:?}");
    assert_eq!(hits[0]["id"], task);
    assert_eq!(
        hits[0]["projectId"], pid,
        "re-resolved project_id is still correct, not dropped or blanked"
    );
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

    // NOTE on what this test does *not* check: it's tempting to also assert
    // the snippet/search behavior proves `comment_doc` ran its body through
    // `domain::sanitize::plain_text` rather than indexing raw HTML. That
    // can't be done soundly at this level — verified by hand against the
    // real DB: Postgres's default text-search parser recognizes `<tag>`
    // sequences ("tag" token type) *and* `&entity;` sequences ("entity"
    // token type) and discards both before dictionary lookup, with no
    // lexemes emitted either way. So `<p>x</p>` and `x`, or `Tom &amp;
    // Jerry` and `Tom & Jerry`, tokenize identically — neither the tsvector
    // nor the `ts_headline` snippet can tell a sanitized body from a raw
    // one for this system's tag/entity set. That call-site behavior (does
    // `comment_doc` actually project through `plain_text`?) is covered
    // instead by a DB-free unit test on the builder itself: see
    // `search::indexer::tests::comment_doc_projects_through_plain_text` in
    // `crates/transport/src/search/indexer.rs`.
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

#[tokio::test]
async fn project_is_indexed_and_delete_clears_its_children() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);

    let pname = term();
    let pid = ok(
        &router,
        &format!("{PROJECT}/CreateProject"),
        &to,
        json!({ "name": format!("Proyek {pname}") }),
    )
    .await["id"]
        .as_str()
        .unwrap()
        .to_string();

    let hits = find(&router, &to, &pname).await;
    assert_eq!(hits.len(), 1, "project findable: {hits:?}");
    assert_eq!(hits[0]["kind"], "PROJECT");
    assert_eq!(hits[0]["id"], pid);

    let m = module_in(&router, &to, &pid).await;
    let tterm = term();
    ok(
        &router,
        &format!("{TASK}/CreateTask"),
        &to,
        json!({ "moduleId": m, "title": format!("X {tterm}") }),
    )
    .await;
    assert_eq!(find(&router, &to, &tterm).await.len(), 1);

    ok(
        &router,
        &format!("{PROJECT}/DeleteProject"),
        &to,
        json!({ "id": pid }),
    )
    .await;
    assert!(find(&router, &to, &pname).await.is_empty(), "project doc gone");
    assert!(
        find(&router, &to, &tterm).await.is_empty(),
        "child task doc gone"
    );
}

#[tokio::test]
async fn person_is_indexed_and_leaves_on_suspend() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let admin = mk_user(&store).await;
    let admin_tok = auth::sign_jwt(SECRET, &admin, &["*".to_string()], 9_999_999_999).unwrap();

    let name = term();
    let created = ok(
        &router,
        &format!("{USERS}/CreateUser"),
        &admin_tok,
        json!({
            "phone": format!("s{}", uniq()), "password": "secret123", "displayName": format!("Rina {name}")
        }),
    )
    .await;
    let uid = created["id"].as_str().unwrap().to_string();

    let hits = find(&router, &admin_tok, &name).await;
    assert_eq!(hits.len(), 1, "person findable: {hits:?}");
    assert_eq!(hits[0]["kind"], "USER");
    assert_eq!(hits[0]["id"], uid);

    ok(
        &router,
        &format!("{USERS}/SuspendUser"),
        &admin_tok,
        json!({ "id": uid }),
    )
    .await;
    assert!(
        find(&router, &admin_tok, &name).await.is_empty(),
        "suspended person leaves the index"
    );
}

#[tokio::test]
async fn self_profile_update_is_indexed() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    // Self-service: the caller updates their own profile with their own
    // token, not an admin's — the AuthService::UpdateMyProfile call site,
    // separate from directory_service.rs's admin-only UpdateUser.
    let me = mk_user(&store).await;
    let my_tok = token(&me);

    let name = term();
    ok(
        &router,
        &format!("{AUTH}/UpdateMyProfile"),
        &my_tok,
        json!({ "displayName": format!("Sari {name}") }),
    )
    .await;

    let hits = find(&router, &my_tok, &name).await;
    assert_eq!(hits.len(), 1, "self-updated profile is findable: {hits:?}");
    assert_eq!(hits[0]["kind"], "USER");
    assert_eq!(hits[0]["id"], me);
}

#[tokio::test]
async fn ranking_kinds_filter_and_person_refinement() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let mate = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[&mate]).await;
    let to = token(&owner);
    let m = module_in(&router, &to, &pid).await;

    let t = term();
    // A page also matches, to prove the kinds filter. Created (and titled)
    // *before* the tasks below: a single-word title match scores identically
    // at weight A regardless of surrounding words (ts_rank's default
    // normalization ignores document length), so this page's title hit would
    // otherwise exactly tie the task's title hit and, per `ORDER BY score
    // DESC, updated_at DESC`, win on recency — defeating the "title beats
    // body" assertion below. Creating it first makes the titled task the
    // more-recently-touched of the two weight-A hits, so the real tie-break
    // resolves the way this test needs it to.
    let page = ok(&router, &format!("{PAGE}/CreatePage"), &to, json!({ "projectId": pid })).await["id"]
        .as_str().unwrap().to_string();
    ok(&router, &format!("{PAGE}/UpdatePage"), &to, json!({ "id": page, "title": format!("Doc {t}") })).await;

    // One task matches in the title, another only in the description.
    let titled = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({
        "moduleId": m, "title": format!("Judul {t}")
    })).await["id"].as_str().unwrap().to_string();
    let body_only = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({
        "moduleId": m, "title": "Lain", "description": format!("<p>isi {t}</p>")
    })).await["id"].as_str().unwrap().to_string();

    let hits = find(&router, &to, &t).await;
    assert_eq!(hits.len(), 3, "three documents match: {hits:?}");
    // NOT proof of the A/B weighting: the page's title hit and the task's
    // title hit are exactly tied on score (both single weight-A matches;
    // ts_rank's default normalization ignores document length), so this only
    // checks that ORDER BY's updated_at DESC tie-break picks the
    // more-recently-touched of the two — which is `titled`, because the page
    // above was deliberately created first. See the comment on `page` above.
    assert_eq!(hits[0]["id"], titled, "the more recently touched of the two tied title hits ranks first");
    // The real weighting property, independent of how the two title hits tie
    // with each other: a body-only match always sorts below both of them.
    assert_eq!(hits[2]["id"], body_only, "a body-only match ranks last: {hits:?}");

    // Kinds filter.
    let v = ok(&router, &format!("{SEARCH}/Search"), &to, json!({ "q": t, "kinds": ["PAGE"] })).await;
    let only = v["results"].as_array().unwrap();
    assert_eq!(only.len(), 1);
    assert_eq!(only[0]["kind"], "PAGE");

    // Person refinement: assign one task to `mate`, then filter by them.
    ok(&router, &format!("{TASK}/UpdateTask"), &to, json!({
        "id": titled, "assigneeIds": { "values": [mate] }
    })).await;
    let v = ok(&router, &format!("{SEARCH}/Search"), &to, json!({ "q": t, "assigneeIds": [mate] })).await;
    let mine = v["results"].as_array().unwrap();
    assert_eq!(mine.len(), 1, "only that person's task: {mine:?}");
    assert_eq!(mine[0]["id"], titled);
    assert_eq!(mine[0]["kind"], "TASK", "non-task kinds have empty assignees, so they drop out");
}

/// Deleting a module cascade-deletes its tasks, and deleting a task orphans its
/// comments. Neither cascade touches the index on its own, so both used to leave
/// findable ghosts: search would return a task or a comment thread that opens
/// nothing. Covers both paths in one test since they share the same helper.
#[tokio::test]
async fn deleting_a_module_or_task_removes_its_docs_and_its_comments() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[]).await;
    let to = token(&owner);

    // Path 1: delete the task directly — its comment must go too.
    let m1 = module_in(&router, &to, &pid).await;
    let t_direct = term();
    let c_direct = term();
    let task1 = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m1, "title": format!("D {t_direct}") })).await["id"].as_str().unwrap().to_string();
    ok(&router, &format!("{COMMENT}/CreateComment"), &to, json!({ "taskId": task1, "content": format!("<p>catatan {c_direct}</p>") })).await;
    assert_eq!(find(&router, &to, &t_direct).await.len(), 1, "task indexed");
    assert_eq!(find(&router, &to, &c_direct).await.len(), 1, "comment indexed");

    ok(&router, &format!("{TASK}/DeleteTask"), &to, json!({ "id": task1 })).await;
    assert!(find(&router, &to, &t_direct).await.is_empty(), "deleted task gone");
    assert!(find(&router, &to, &c_direct).await.is_empty(), "its comment gone too");

    // Path 2: delete the module — every task under it, and their comments, go.
    let m2 = module_in(&router, &to, &pid).await;
    let t_cascade = term();
    let c_cascade = term();
    let task2 = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m2, "title": format!("C {t_cascade}") })).await["id"].as_str().unwrap().to_string();
    ok(&router, &format!("{COMMENT}/CreateComment"), &to, json!({ "taskId": task2, "content": format!("<p>catatan {c_cascade}</p>") })).await;
    assert_eq!(find(&router, &to, &t_cascade).await.len(), 1, "task indexed");
    assert_eq!(find(&router, &to, &c_cascade).await.len(), 1, "comment indexed");

    ok(&router, &format!("{MODULE}/DeleteModule"), &to, json!({ "id": m2 })).await;
    assert!(find(&router, &to, &t_cascade).await.is_empty(), "cascaded task gone");
    assert!(find(&router, &to, &c_cascade).await.is_empty(), "its comment gone too");
}
