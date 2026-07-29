//! End-to-end MediaService over the real Connect routers + Postgres, with a fake
//! object Storage (no RustFS needed). Skipped unless `DATABASE_URL` is set.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

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
use storage::Storage;
use tower::ServiceExt;

const SECRET: &str = "test-secret";
const PROJECT: &str = "/sedjiwa.tasks.project.v1.ProjectService";
const MODULE: &str = "/sedjiwa.tasks.work.v1.ModuleService";
const TASK: &str = "/sedjiwa.tasks.work.v1.TaskService";
const MEDIA: &str = "/sedjiwa.tasks.media.v1.MediaService";

fn uniq() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos().to_string()
}

/// In-memory Storage: `uploaded` simulates objects present in S3; records deletes.
#[derive(Default)]
struct FakeStorage {
    uploaded: Mutex<HashMap<String, u64>>,
    deleted: Mutex<Vec<String>>,
}
#[async_trait::async_trait]
impl Storage for FakeStorage {
    async fn presign_put(&self, key: &str, _mime: &str, _ttl: u32) -> anyhow::Result<String> {
        Ok(format!("http://fake/put/{key}"))
    }
    async fn presign_get(&self, key: &str, _ttl: u32) -> anyhow::Result<String> {
        Ok(format!("http://fake/get/{key}"))
    }
    async fn head(&self, key: &str) -> anyhow::Result<Option<u64>> {
        Ok(self.uploaded.lock().unwrap().get(key).copied())
    }
    async fn delete(&self, key: &str) -> anyhow::Result<()> {
        self.deleted.lock().unwrap().push(key.to_string());
        Ok(())
    }
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

async fn setup() -> Option<(Router, Arc<Store>, Arc<FakeStorage>)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let store = Arc::new(Store::connect(&url, domain::register_all).await.unwrap());
    let fake = Arc::new(FakeStorage::default());
    let storage: Arc<dyn Storage> = fake.clone();
    let router = transport::project_router(store.clone())
        .merge(transport::module_router(store.clone()))
        .merge(transport::task_router(store.clone()))
        .merge(transport::media_router(store.clone(), storage))
        .layer(from_fn(auth_mw));
    Some((router, store, fake))
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

async fn project_with(router: &Router, owner: &str, members: &[&str]) -> String {
    let p = ok(router, &format!("{PROJECT}/CreateProject"), &token(owner), json!({ "name": format!("P{}", uniq()) })).await;
    let id = p["id"].as_str().unwrap().to_string();
    for m in members {
        ok(router, &format!("{PROJECT}/AddProjectMember"), &token(owner), json!({ "projectId": id, "userId": m })).await;
    }
    id
}

/// Create a module + task in `project`, return the task id.
async fn task_in(router: &Router, owner_tok: &str, member_tok: &str, project: &str) -> String {
    let m = ok(router, &format!("{MODULE}/CreateModule"), owner_tok, json!({ "projectId": project, "name": "M" })).await["id"].as_str().unwrap().to_string();
    ok(router, &format!("{TASK}/CreateTask"), member_tok, json!({ "moduleId": m, "title": "T" })).await["id"].as_str().unwrap().to_string()
}

fn file_ids(body: &Value) -> Vec<String> {
    body["files"].as_array().cloned().unwrap_or_default().iter().map(|f| f["id"].as_str().unwrap().to_string()).collect()
}

#[tokio::test]
async fn upload_lifecycle_download_and_delete() {
    let Some((router, store, fake)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let member = mk_user(&store).await; // uploader
    let other = mk_user(&store).await; // member, not uploader/owner
    let pid = project_with(&router, &owner, &[&member, &other]).await;
    let (to, tm, tother) = (token(&owner), token(&member), token(&other));

    // Create upload → Pending row + presigned PUT.
    let up = ok(&router, &format!("{MEDIA}/CreateMediaUpload"), &tm, json!({ "projectId": pid, "fileName": "a.png", "mimeType": "image/png", "size": 100 })).await;
    let mid = up["mediaFileId"].as_str().unwrap().to_string();
    let key = up["storageKey"].as_str().unwrap().to_string();
    assert!(up["uploadUrl"].as_str().unwrap().contains(&key));

    // Pending is excluded from the list.
    let list = ok(&router, &format!("{MEDIA}/ListProjectMedia"), &tm, json!({ "projectId": pid })).await;
    assert!(file_ids(&list).is_empty(), "pending excluded from list");

    // Complete before upload → object missing → failed precondition.
    let (st, _) = call(&router, &format!("{MEDIA}/CompleteMediaUpload"), Some(&tm), json!({ "mediaFileId": mid })).await;
    assert_ne!(st, StatusCode::OK, "complete without upload rejected");

    // Simulate the client PUT (S3 now has the object, size 123).
    fake.uploaded.lock().unwrap().insert(key.clone(), 123);

    // Complete → Ready, size from HEAD (123, int64 JSON = string).
    let done = ok(&router, &format!("{MEDIA}/CompleteMediaUpload"), &tm, json!({ "mediaFileId": mid })).await;
    assert_eq!(done["status"], "READY");
    assert_eq!(done["size"], "123", "size taken from storage HEAD");
    let list = ok(&router, &format!("{MEDIA}/ListProjectMedia"), &tm, json!({ "projectId": pid })).await;
    assert_eq!(file_ids(&list), vec![mid.clone()], "ready file now listed");

    // Non-member cannot list.
    let outsider = token(&mk_user(&store).await);
    let (st, _) = call(&router, &format!("{MEDIA}/ListProjectMedia"), Some(&outsider), json!({ "projectId": pid })).await;
    assert_ne!(st, StatusCode::OK, "non-member cannot list media");

    // Download url (presigned GET, expires 300).
    let dl = ok(&router, &format!("{MEDIA}/GetMediaDownloadUrl"), &tm, json!({ "mediaFileId": mid })).await;
    assert!(dl["url"].as_str().unwrap().contains(&key));
    assert_eq!(dl["expiresIn"], 300);

    // Delete guard: a member who is neither uploader nor owner is denied.
    let (st, _) = call(&router, &format!("{MEDIA}/DeleteMediaFile"), Some(&tother), json!({ "mediaFileId": mid })).await;
    assert_ne!(st, StatusCode::OK, "non-uploader non-owner cannot delete");
    // Owner can delete → object deleted, row gone.
    ok(&router, &format!("{MEDIA}/DeleteMediaFile"), &to, json!({ "mediaFileId": mid })).await;
    assert!(fake.deleted.lock().unwrap().contains(&key), "storage object deleted");
    let list = ok(&router, &format!("{MEDIA}/ListProjectMedia"), &tm, json!({ "projectId": pid })).await;
    assert!(file_ids(&list).is_empty(), "deleted file gone from list");
}

#[tokio::test]
async fn task_media_links() {
    let Some((router, store, fake)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let member = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[&member]).await;
    let (to, tm) = (token(&owner), token(&member));
    let task = task_in(&router, &to, &tm, &pid).await;

    // Upload + complete a file.
    let up = ok(&router, &format!("{MEDIA}/CreateMediaUpload"), &tm, json!({ "projectId": pid, "fileName": "doc.pdf", "mimeType": "application/pdf", "size": 10 })).await;
    let mid = up["mediaFileId"].as_str().unwrap().to_string();
    fake.uploaded.lock().unwrap().insert(up["storageKey"].as_str().unwrap().to_string(), 10);
    ok(&router, &format!("{MEDIA}/CompleteMediaUpload"), &tm, json!({ "mediaFileId": mid })).await;

    // Link (idempotent) → ListTaskMedia shows it once.
    ok(&router, &format!("{MEDIA}/LinkTaskMedia"), &tm, json!({ "taskId": task, "mediaFileId": mid })).await;
    ok(&router, &format!("{MEDIA}/LinkTaskMedia"), &tm, json!({ "taskId": task, "mediaFileId": mid })).await; // idempotent
    let linked = ok(&router, &format!("{MEDIA}/ListTaskMedia"), &tm, json!({ "taskId": task })).await;
    assert_eq!(file_ids(&linked), vec![mid.clone()]);

    // Cross-project link rejected: a task in a different project.
    let pid2 = project_with(&router, &owner, &[&member]).await;
    let task2 = task_in(&router, &to, &tm, &pid2).await;
    let (st, _) = call(&router, &format!("{MEDIA}/LinkTaskMedia"), Some(&tm), json!({ "taskId": task2, "mediaFileId": mid })).await;
    assert_ne!(st, StatusCode::OK, "cross-project link rejected");

    // Unlink → empty.
    ok(&router, &format!("{MEDIA}/UnlinkTaskMedia"), &tm, json!({ "taskId": task, "mediaFileId": mid })).await;
    let after = ok(&router, &format!("{MEDIA}/ListTaskMedia"), &tm, json!({ "taskId": task })).await;
    assert!(file_ids(&after).is_empty(), "unlinked");
}
