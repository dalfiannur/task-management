//! End-to-end project trash: DeleteProject hides a project everywhere, an
//! admin restores it exactly or purges it for good, and leftovers from old
//! hard deletes are cleaned on request. Skipped unless `DATABASE_URL` is set.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

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
use storage::Storage;
use tower::ServiceExt;
use transport::Notifier;

const SECRET: &str = "test-secret";
const PROJECT: &str = "/sedjiwa.tasks.project.v1.ProjectService";
const MODULE: &str = "/sedjiwa.tasks.work.v1.ModuleService";
const TASK: &str = "/sedjiwa.tasks.work.v1.TaskService";
const LABEL: &str = "/sedjiwa.tasks.label.v1.LabelService";
const COMMENT: &str = "/sedjiwa.tasks.comment.v1.CommentService";
const SEARCH: &str = "/sedjiwa.tasks.search.v1.SearchService";
const ACTIVITY: &str = "/sedjiwa.tasks.activity.v1.ActivityService";
const TIME: &str = "/sedjiwa.tasks.time.v1.TimeService";
const WORK: &str = "/sedjiwa.tasks.workload.v1.WorkloadService";
const TPL: &str = "/sedjiwa.tasks.templates.v1.TemplateService";
const DASH: &str = "/sedjiwa.tasks.dashboard.v1.DashboardService";
const MINE: &str = "/sedjiwa.tasks.dashboard.v1.MyTasksService";
const REPORT: &str = "/sedjiwa.tasks.reports.v1.ReportService";
const PAGE: &str = "/sedjiwa.tasks.page.v1.PageService";
const MEDIA: &str = "/sedjiwa.tasks.media.v1.MediaService";
const VIEW: &str = "/sedjiwa.tasks.view.v1.SavedViewService";
const AUTO: &str = "/sedjiwa.tasks.automation.v1.AutomationService";
const TRASH: &str = "/sedjiwa.tasks.trash.v1.ProjectTrashService";

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

async fn setup() -> Option<(Router, Arc<Store>, Arc<FakeStorage>)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let store = Arc::new(Store::connect(&url).await.unwrap());
    let fake = Arc::new(FakeStorage::default());
    let storage: Arc<dyn Storage> = fake.clone();
    let notifier = Arc::new(Notifier::new());
    let router = transport::project_router(store.clone())
        .merge(transport::module_router(store.clone()))
        .merge(transport::task_router(store.clone()))
        .merge(transport::status_router(store.clone()))
        .merge(transport::label_router(store.clone()))
        .merge(transport::comment_router(store.clone()))
        .merge(transport::search_router(store.clone()))
        .merge(transport::activity_router(store.clone()))
        .merge(transport::time_router(store.clone()))
        .merge(transport::workload_router(store.clone()))
        .merge(transport::template_router(store.clone()))
        .merge(transport::dashboard_router(store.clone()))
        .merge(transport::mytasks_router(store.clone()))
        .merge(transport::report_router(store.clone()))
        .merge(transport::page_router(store.clone()))
        .merge(transport::media_router(store.clone(), storage.clone()))
        .merge(transport::view_router(store.clone()))
        .merge(transport::automation_router(store.clone()))
        .merge(transport::notification_router(store.clone(), notifier.clone()))
        .merge(transport::trash_router(store.clone(), storage))
        .layer(Extension(notifier))
        .layer(from_fn(auth_mw));
    Some((router, store, fake))
}

fn token(sub: &str) -> String {
    sign_jwt(SECRET, sub, &["projects:create".to_string()], 9_999_999_999).unwrap()
}

fn admin_token(sub: &str) -> String {
    sign_jwt(SECRET, sub, &["*".to_string()], 9_999_999_999).unwrap()
}

async fn call(router: &Router, path: &str, token: Option<&str>, body: Value) -> (StatusCode, Value) {
    let mut b = Request::builder().method("POST").uri(path).header(CONTENT_TYPE, "application/json");
    if let Some(t) = token {
        b = b.header(AUTHORIZATION, format!("Bearer {t}"));
    }
    let resp = router.clone().oneshot(b.body(Body::from(body.to_string())).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

async fn ok(router: &Router, path: &str, tok: &str, body: Value) -> Value {
    let (st, v) = call(router, path, Some(tok), body).await;
    assert_eq!(st, StatusCode::OK, "{path}: {v}");
    v
}

async fn fails(router: &Router, path: &str, tok: &str, body: Value, code: &str) {
    let (st, v) = call(router, path, Some(tok), body).await;
    assert_ne!(st, StatusCode::OK, "{path} should fail: {v}");
    assert_eq!(v["code"], code, "{path}: {v}");
}

fn s(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or_default().to_string()
}

fn arr(v: &Value, key: &str) -> Vec<Value> {
    v[key].as_array().cloned().unwrap_or_default()
}

async fn mk_user(store: &Store) -> String {
    let now = "2026-01-01T00:00:00Z".to_string();
    store
        .create((
            UserPhone { value: format!("x{}", uniq()), verified: true },
            UserPassword { hash: "x".into(), changed_at: now.clone() },
            UserProfile { display_name: "X".into(), avatar_url: String::new(), email: String::new() },
            UserStatusComponent { status: "active".into(), created_at: now, last_login_at: None },
        ))
        .await
        .unwrap()
        .to_string()
}

/// A project with one of everything that belongs to a project.
#[allow(dead_code)]
struct Rich {
    pid: String,
    name: String,
    marker: String,
    module: String,
    task: String,
    sub: String,
    comment: String,
    entry: String,
    label: String,
    page: String,
    view: String,
    template: String,
    media: String,
    media_key: String,
    rule: String,
}

async fn rich(router: &Router, fake: &FakeStorage, owner: &str, member: &str) -> Rich {
    let (to, tm) = (token(owner), token(member));
    let marker = format!("trashmark{}", uniq());
    let name = format!("{marker} project");
    let p = ok(router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": name })).await;
    let pid = s(&p, "id");
    ok(router, &format!("{PROJECT}/AddProjectMember"), &to, json!({ "projectId": pid, "userId": member })).await;
    let module = s(&ok(router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": pid, "name": "M" })).await, "id");
    let label = s(&ok(router, &format!("{LABEL}/CreateLabel"), &to, json!({ "projectId": pid, "name": "l", "color": "#123456" })).await, "id");
    let rule = s(&ok(router, &format!("{AUTO}/CreateAutomation"), &to, json!({
        "projectId": pid, "name": "note", "mode": "AUTOMATION_MODE_ON", "trigger": { "taskCreated": {} },
        "actions": [{ "comment": "auto" }]
    })).await, "id");
    let task = s(&ok(router, &format!("{TASK}/CreateTask"), &to, json!({
        "moduleId": module, "title": format!("{marker} task"), "assigneeIds": [member], "estimateMinutes": 120,
        "dueDate": "2026-01-05", "labelIds": [label]
    })).await, "id");
    let sub = s(&ok(router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": module, "title": "sub", "parentId": task })).await, "id");
    let comment = s(&ok(router, &format!("{COMMENT}/CreateComment"), &tm, json!({ "taskId": task, "content": format!("{marker} comment") })).await, "id");
    let entry = s(&ok(router, &format!("{TIME}/LogTime"), &tm, json!({ "taskId": task, "minutes": 30 })).await, "id");
    let page = s(&ok(router, &format!("{PAGE}/CreatePage"), &to, json!({ "projectId": pid, "title": format!("{marker} page") })).await, "id");
    let view = s(&ok(router, &format!("{VIEW}/CreateSavedView"), &to, json!({ "projectId": pid, "name": "v", "query": "", "shared": true })).await, "id");
    let template = s(&ok(router, &format!("{TPL}/SaveTaskTemplate"), &to, json!({ "taskId": task, "name": "t" })).await, "id");
    let up = ok(router, &format!("{MEDIA}/CreateMediaUpload"), &to, json!({ "projectId": pid, "fileName": "a.png", "mimeType": "image/png", "size": 10 })).await;
    let (media, media_key) = (s(&up, "mediaFileId"), s(&up, "storageKey"));
    fake.uploaded.lock().unwrap().insert(media_key.clone(), 10);
    ok(router, &format!("{MEDIA}/CompleteMediaUpload"), &to, json!({ "mediaFileId": media })).await;
    ok(router, &format!("{MEDIA}/LinkTaskMedia"), &to, json!({ "taskId": task, "mediaFileId": media })).await;
    Rich { pid, name, marker, module, task, sub, comment, entry, label, page, view, template, media, media_key, rule }
}

/// Row counts of everything that belongs to a project, by table.
async fn owned_counts(store: &Store, pid: &str) -> Vec<(String, i64)> {
    let by_project = [
        "cmp_moduleprojectref", "cmp_projectmembership", "cmp_labelinfo", "cmp_taskstatusdef", "cmp_pageinfo",
        "cmp_mediafileinfo", "cmp_taskmedialinkdata", "cmp_activityinfo", "cmp_timeentry", "cmp_savedview",
        "cmp_automation", "cmp_automationrun", "cmp_tasktemplate", "cmp_tasknumber", "cmp_notificationrefs",
        "search_doc",
    ];
    let mut out = Vec::new();
    for t in by_project {
        let n: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {t} WHERE project_id = $1"))
            .bind(pid)
            .fetch_one(store.pool())
            .await
            .unwrap();
        out.push((t.to_string(), n));
    }
    let tasks = "SELECT pid::text FROM cmp_tasknumber WHERE project_id = $1";
    for (t, col) in [("cmp_commentinfo", "task_id"), ("cmp_activitytask", "task_id"), ("cmp_automationfired", "task_id")] {
        let n: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {t} WHERE {col} IN ({tasks})"))
            .bind(pid)
            .fetch_one(store.pool())
            .await
            .unwrap();
        out.push((format!("{t} (by task)"), n));
    }
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM arke_entities WHERE pid::text = $1")
        .bind(pid)
        .fetch_one(store.pool())
        .await
        .unwrap();
    out.push(("project entity".into(), n));
    out
}

// ── Access ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn only_admins_use_the_trash() {
    let Some((router, store, _fake)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, member) = (mk_user(&store).await, mk_user(&store).await);
    let (to, tm) = (token(&owner), token(&member));
    let p = s(&ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("T{}", uniq()) })).await, "id");
    ok(&router, &format!("{PROJECT}/AddProjectMember"), &to, json!({ "projectId": p, "userId": member })).await;
    for (m, body) in [
        ("ListDeletedProjects", json!({})),
        ("RestoreProject", json!({ "id": p })),
        ("PurgeProject", json!({ "id": p })),
        ("PurgeLeftovers", json!({})),
    ] {
        let (st, v) = call(&router, &format!("{TRASH}/{m}"), None, body.clone()).await;
        assert_eq!(v["code"], "unauthenticated", "{m} without a token: {st} {v}");
    }
    // Members can't delete; the owner can, but can't see the trash or restore.
    fails(&router, &format!("{PROJECT}/DeleteProject"), &tm, json!({ "id": p }), "permission_denied").await;
    ok(&router, &format!("{PROJECT}/DeleteProject"), &to, json!({ "id": p })).await;
    for tok in [&to, &tm] {
        for (m, body) in [
            ("ListDeletedProjects", json!({})),
            ("RestoreProject", json!({ "id": p })),
            ("PurgeProject", json!({ "id": p })),
            ("PurgeLeftovers", json!({})),
        ] {
            fails(&router, &format!("{TRASH}/{m}"), tok, body, "permission_denied").await;
        }
    }
    // Deleting again: it is already gone.
    fails(&router, &format!("{PROJECT}/DeleteProject"), &to, json!({ "id": p }), "not_found").await;
    // An admin sees who trashed it and when.
    let admin = mk_user(&store).await;
    let l = ok(&router, &format!("{TRASH}/ListDeletedProjects"), &admin_token(&admin), json!({})).await;
    let row = arr(&l, "projects").into_iter().find(|x| s(x, "id") == p).expect("listed in the trash");
    assert_eq!(row["deletedBy"], owner.as_str());
    assert_eq!(row["ownerId"], owner.as_str());
    assert!(row["deletedAt"].is_string());
    // Restore / purge only apply to trashed projects.
    let live = s(&ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("L{}", uniq()) })).await, "id");
    fails(&router, &format!("{TRASH}/RestoreProject"), &admin_token(&admin), json!({ "id": live }), "not_found").await;
    fails(&router, &format!("{TRASH}/PurgeProject"), &admin_token(&admin), json!({ "id": live }), "not_found").await;
    fails(&router, &format!("{TRASH}/RestoreProject"), &admin_token(&admin), json!({ "id": "999999999999" }), "not_found").await;
    assert!(ok(&router, &format!("{PROJECT}/GetProject"), &to, json!({ "id": live })).await["id"] == live.as_str(), "the live project is untouched");
}

// ── Hidden everywhere, restored exactly ──────────────────────────────────────

/// Everything a reader could see of `r`, as one comparable snapshot.
async fn visible(router: &Router, tok: &str, r: &Rich) -> Value {
    json!({
        "tasks": arr(&ok(router, &format!("{TASK}/ListTasks"), tok, json!({ "projectId": r.pid })).await, "tasks").len(),
        "task": ok(router, &format!("{TASK}/GetTask"), tok, json!({ "id": r.task })).await["title"],
        "comments": arr(&ok(router, &format!("{COMMENT}/ListComments"), tok, json!({ "taskId": r.task })).await, "comments").len(),
        "time": arr(&ok(router, &format!("{TIME}/ListTimeEntries"), tok, json!({ "projectId": r.pid })).await, "entries").len(),
        "labels": arr(&ok(router, &format!("{LABEL}/ListLabels"), tok, json!({ "projectId": r.pid })).await, "labels").len(),
        "pages": arr(&ok(router, &format!("{PAGE}/ListPages"), tok, json!({ "projectId": r.pid })).await, "pages").len(),
        "views": arr(&ok(router, &format!("{VIEW}/ListSavedViews"), tok, json!({ "projectId": r.pid })).await, "views").len(),
        "templates": arr(&ok(router, &format!("{TPL}/ListTaskTemplates"), tok, json!({ "projectId": r.pid })).await, "templates").len(),
        "media": arr(&ok(router, &format!("{MEDIA}/ListProjectMedia"), tok, json!({ "projectId": r.pid })).await, "files").len(),
        "rules": arr(&ok(router, &format!("{AUTO}/ListAutomations"), tok, json!({ "projectId": r.pid })).await, "automations").len(),
        "activity": ok(router, &format!("{ACTIVITY}/ListProjectActivity"), tok, json!({ "projectId": r.pid })).await["total"],
    })
}

#[tokio::test]
async fn a_trashed_project_is_hidden_everywhere_and_restored_exactly() {
    use base64::Engine;
    use calamine::{Reader, Xlsx};
    let Some((router, store, fake)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, member, admin) = (mk_user(&store).await, mk_user(&store).await, mk_user(&store).await);
    let (to, tm, ta) = (token(&owner), token(&member), admin_token(&admin));
    let r = rich(&router, &fake, &owner, &member).await;
    // A second project of the member's that must stay visible throughout.
    let q = s(&ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("Q{}", uniq()) })).await, "id");
    ok(&router, &format!("{PROJECT}/AddProjectMember"), &to, json!({ "projectId": q, "userId": member })).await;
    let before_member = visible(&router, &tm, &r).await;
    let before_admin = visible(&router, &ta, &r).await;
    assert_eq!(before_member["tasks"], 2);
    assert_eq!(before_member["comments"], 2, "the member's comment and the rule's");

    ok(&router, &format!("{PROJECT}/DeleteProject"), &to, json!({ "id": r.pid })).await;

    for (who, tok) in [("member", tm.clone()), ("admin", ta.clone()), ("owner", to.clone())] {
        // Lists and the project itself.
        let lp = ok(&router, &format!("{PROJECT}/ListProjects"), &tok, json!({ "limit": 200 })).await;
        let ids: Vec<String> = arr(&lp, "projects").iter().map(|p| s(p, "id")).collect();
        assert!(!ids.contains(&r.pid), "{who}: not in ListProjects");
        let tl = ok(&router, &format!("{PROJECT}/ListProjects"), &tok, json!({ "limit": 200, "templates": true })).await;
        assert!(arr(&tl, "projects").iter().all(|p| s(p, "id") != r.pid), "{who}: not among templates");
        if who == "member" {
            assert!(ids.contains(&q), "member: Q is still listed");
        }
        // Every per-project and per-task path answers not_found.
        for (path, body) in [
            (format!("{PROJECT}/GetProject"), json!({ "id": r.pid })),
            (format!("{PROJECT}/ListProjectMembers"), json!({ "projectId": r.pid })),
            (format!("{MODULE}/ListModules"), json!({ "projectId": r.pid })),
            (format!("{TASK}/ListTasks"), json!({ "projectId": r.pid })),
            (format!("{TASK}/GetTask"), json!({ "id": r.task })),
            (format!("{TASK}/GetTask"), json!({ "id": r.sub })),
            (format!("{TASK}/CreateTask"), json!({ "moduleId": r.module, "title": "x" })),
            (format!("{TASK}/UpdateTask"), json!({ "id": r.task, "title": "x" })),
            (format!("{COMMENT}/ListComments"), json!({ "taskId": r.task })),
            (format!("{COMMENT}/CreateComment"), json!({ "taskId": r.task, "content": "x" })),
            (format!("{TIME}/LogTime"), json!({ "taskId": r.task, "minutes": 5 })),
            (format!("{TIME}/ListTimeEntries"), json!({ "projectId": r.pid })),
            (format!("{TIME}/ListTimeEntries"), json!({ "taskId": r.task })),
            (format!("{LABEL}/ListLabels"), json!({ "projectId": r.pid })),
            (format!("{PAGE}/ListPages"), json!({ "projectId": r.pid })),
            (format!("{PAGE}/GetPage"), json!({ "id": r.page })),
            (format!("{MEDIA}/ListProjectMedia"), json!({ "projectId": r.pid })),
            (format!("{MEDIA}/GetMediaDownloadUrl"), json!({ "mediaFileId": r.media })),
            (format!("{VIEW}/ListSavedViews"), json!({ "projectId": r.pid })),
            (format!("{TPL}/ListTaskTemplates"), json!({ "projectId": r.pid })),
            (format!("{AUTO}/ListAutomations"), json!({ "projectId": r.pid })),
            (format!("{AUTO}/ListAutomationRuns"), json!({ "projectId": r.pid })),
            (format!("{ACTIVITY}/ListProjectActivity"), json!({ "projectId": r.pid })),
            (format!("{ACTIVITY}/ListEntityActivity"), json!({ "entityType": "TASK", "entityId": r.task })),
            (format!("{WORK}/GetWorkload"), json!({ "projectId": r.pid })),
            (format!("{WORK}/GetWorkCalendar"), json!({ "scope": "CALENDAR_SCOPE_PROJECT", "id": r.pid })),
            (format!("{DASH}/GetProjectOverview"), json!({ "projectId": r.pid })),
            (format!("{PROJECT}/CreateProject"), json!({ "name": "copy", "fromProjectId": r.pid })),
        ] {
            fails(&router, &path, &tok, body, "not_found").await;
        }
        // Cross-project reads leave it out.
        let d = ok(&router, &format!("{DASH}/GetDashboardStats"), &tok, json!({})).await;
        assert!(arr(&d, "perProject").iter().all(|x| s(x, "projectId") != r.pid), "{who}: dashboard");
        let up = ok(&router, &format!("{DASH}/GetUpcomingDeadlines"), &tok, json!({ "withinDays": 30, "includeOverdue": true })).await;
        assert!(arr(&up, "items").iter().all(|x| x["task"]["id"] != r.task.as_str()), "{who}: upcoming/overdue");
        let mine = ok(&router, &format!("{MINE}/ListAssignedToMe"), &tok, json!({ "pageSize": 100 })).await;
        assert!(arr(&mine, "items").iter().all(|x| x["task"]["id"] != r.task.as_str()), "{who}: my tasks");
        let hits = ok(&router, &format!("{SEARCH}/Search"), &tok, json!({ "q": r.marker, "limit": 50 })).await;
        assert!(arr(&hits, "results").is_empty(), "{who}: search finds nothing of it: {hits}");
        let w = ok(&router, &format!("{WORK}/GetWorkload"), &tok, json!({ "today": "2026-10-21", "weeks": 2 })).await;
        assert!(arr(&w, "projects").iter().all(|x| s(x, "id") != r.pid), "{who}: workload projects");
        assert!(!w.to_string().contains(&format!("\"{}\"", r.task)), "{who}: workload mentions none of its tasks");
        let recent = ok(&router, &format!("{ACTIVITY}/ListRecentActivity"), &tok, json!({ "pageSize": 200 })).await;
        assert!(arr(&recent, "activities").iter().all(|a| s(a, "projectId") != r.pid), "{who}: recent activity");
        let byuser = ok(&router, &format!("{TIME}/ListTimeEntries"), &tok, json!({ "userId": member })).await;
        assert!(arr(&byuser, "entries").iter().all(|e| s(e, "projectId") != r.pid), "{who}: time by user");
        let dd = time::OffsetDateTime::now_utc().date();
        let (from, until) = (dd - time::Duration::days(30), dd + time::Duration::days(2));
        let body = json!({
            "periodStart": format!("{from}T00:00:00Z"), "periodEnd": format!("{until}T00:00:00Z"),
            "periodStartDate": from.to_string(), "periodEndDate": until.to_string(),
        });
        let rep = ok(&router, &format!("{REPORT}/GetPeriodReport"), &tok, body.clone()).await;
        assert!(arr(&rep, "perProject").iter().all(|x| s(x, "projectId") != r.pid), "{who}: report per project");
        assert!(rep.to_string().find(&r.marker).is_none(), "{who}: report mentions nothing of it");
        let x = ok(&router, &format!("{REPORT}/ExportPeriodReportXlsx"), &tok, json!({ "report": body, "label": "w", "granularity": "weekly" })).await;
        let bytes = base64::engine::general_purpose::STANDARD.decode(x["xlsx"].as_str().unwrap()).unwrap();
        let mut wb: Xlsx<_> = calamine::open_workbook_from_rs(std::io::Cursor::new(bytes)).unwrap();
        for sheet in wb.sheet_names() {
            let text: String = wb.worksheet_range(&sheet).unwrap().rows().flat_map(|r| r.iter().map(|c| c.to_string())).collect();
            assert!(!text.contains(&r.marker), "{who}: xlsx sheet {sheet} mentions it");
        }
    }
    // Q is untouched for the member.
    ok(&router, &format!("{PROJECT}/GetProject"), &tm, json!({ "id": q })).await;

    // Restore: everything comes back exactly.
    ok(&router, &format!("{TRASH}/RestoreProject"), &ta, json!({ "id": r.pid })).await;
    let l = ok(&router, &format!("{TRASH}/ListDeletedProjects"), &ta, json!({})).await;
    assert!(arr(&l, "projects").iter().all(|x| s(x, "id") != r.pid), "no longer in the trash");
    assert_eq!(visible(&router, &tm, &r).await, before_member, "the member sees exactly what they saw before");
    assert_eq!(visible(&router, &ta, &r).await, before_admin, "and so does the admin");
    let hits = ok(&router, &format!("{SEARCH}/Search"), &tm, json!({ "q": r.marker, "limit": 50 })).await;
    let ids: Vec<String> = arr(&hits, "results").iter().map(|x| s(x, "id")).collect();
    assert!(ids.contains(&r.task) && ids.contains(&r.pid), "search finds it again: {hits}");
    let mine = ok(&router, &format!("{MINE}/ListAssignedToMe"), &tm, json!({ "pageSize": 100 })).await;
    assert!(arr(&mine, "items").iter().any(|x| x["task"]["id"] == r.task.as_str()), "back in my tasks");
    // Its rule works again.
    let t = s(&ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": r.module, "title": "after restore" })).await, "id");
    let c = ok(&router, &format!("{COMMENT}/ListComments"), &to, json!({ "taskId": t })).await;
    assert_eq!(arr(&c, "comments").len(), 1, "the restored rule fires");
    let _ = r.name;
}

// ── Purge ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn purging_removes_everything_of_one_project_and_nothing_else() {
    let Some((router, store, fake)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, member, admin) = (mk_user(&store).await, mk_user(&store).await, mk_user(&store).await);
    let (to, ta) = (token(&owner), admin_token(&admin));
    let doomed = rich(&router, &fake, &owner, &member).await;
    let kept = rich(&router, &fake, &owner, &member).await;
    let before = owned_counts(&store, &doomed.pid).await;
    assert!(before.iter().filter(|(_, n)| *n > 0).count() >= 15, "the fixture really has data everywhere: {before:?}");
    let kept_before = owned_counts(&store, &kept.pid).await;

    // Purge is only from the trash.
    fails(&router, &format!("{TRASH}/PurgeProject"), &ta, json!({ "id": doomed.pid }), "not_found").await;
    ok(&router, &format!("{PROJECT}/DeleteProject"), &to, json!({ "id": doomed.pid })).await;
    assert_eq!(owned_counts(&store, &doomed.pid).await, before, "trashing keeps every row");
    ok(&router, &format!("{TRASH}/PurgeProject"), &ta, json!({ "id": doomed.pid })).await;

    let after = owned_counts(&store, &doomed.pid).await;
    let leftover: Vec<&(String, i64)> = after.iter().filter(|(_, n)| *n > 0).collect();
    assert!(leftover.is_empty(), "nothing of the purged project remains: {leftover:?}");
    for pid in [&doomed.task, &doomed.sub, &doomed.comment, &doomed.entry, &doomed.label, &doomed.page, &doomed.view, &doomed.template, &doomed.media, &doomed.rule, &doomed.module] {
        let n: i64 = sqlx::query_scalar("SELECT count(*) FROM arke_entities WHERE pid::text = $1")
            .bind(pid)
            .fetch_one(store.pool())
            .await
            .unwrap();
        assert_eq!(n, 0, "entity {pid} is gone");
    }
    assert!(fake.deleted.lock().unwrap().contains(&doomed.media_key), "its stored file is deleted");
    assert!(!fake.deleted.lock().unwrap().contains(&kept.media_key), "the other project's file is not");
    assert_eq!(owned_counts(&store, &kept.pid).await, kept_before, "the other project is untouched, row for row");
    let l = ok(&router, &format!("{TRASH}/ListDeletedProjects"), &ta, json!({})).await;
    assert!(arr(&l, "projects").iter().all(|x| s(x, "id") != doomed.pid), "gone from the trash");
    fails(&router, &format!("{TRASH}/PurgeProject"), &ta, json!({ "id": doomed.pid }), "not_found").await;
    fails(&router, &format!("{TRASH}/RestoreProject"), &ta, json!({ "id": doomed.pid }), "not_found").await;
    // The people are untouched.
    for u in [&owner, &member] {
        let n: i64 = sqlx::query_scalar("SELECT count(*) FROM cmp_userprofile WHERE pid::text = $1")
            .bind(u)
            .fetch_one(store.pool())
            .await
            .unwrap();
        assert_eq!(n, 1, "user {u} still exists");
    }
    // The kept project still works end to end.
    ok(&router, &format!("{TASK}/GetTask"), &token(&member), json!({ "id": kept.task })).await;
}

// ── Leftovers ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn leftovers_are_cleaned_without_touching_live_or_trashed_projects() {
    let Some((router, store, fake)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, member, admin) = (mk_user(&store).await, mk_user(&store).await, mk_user(&store).await);
    let (to, ta) = (token(&owner), admin_token(&admin));
    let old = rich(&router, &fake, &owner, &member).await;
    let live = rich(&router, &fake, &owner, &member).await;
    let trashed = rich(&router, &fake, &owner, &member).await;
    ok(&router, &format!("{PROJECT}/DeleteProject"), &to, json!({ "id": trashed.pid })).await;
    // An old-style hard delete: the project entity goes, its data stays behind.
    store.delete(old.pid.parse().unwrap()).await.unwrap();
    let live_before = owned_counts(&store, &live.pid).await;
    let trashed_before = owned_counts(&store, &trashed.pid).await;
    assert!(owned_counts(&store, &old.pid).await.iter().any(|(_, n)| *n > 0), "precondition: leftovers exist");

    let l = ok(&router, &format!("{TRASH}/ListDeletedProjects"), &ta, json!({})).await;
    assert!(l["leftoverCount"].as_i64().unwrap_or(0) >= 1, "leftovers are counted: {l}");
    let r = ok(&router, &format!("{TRASH}/PurgeLeftovers"), &ta, json!({})).await;
    assert!(r["projects"].as_i64().unwrap_or(0) >= 1, "{r}");

    let left: Vec<(String, i64)> = owned_counts(&store, &old.pid).await.into_iter().filter(|(_, n)| *n > 0).collect();
    assert!(left.is_empty(), "nothing of the old project remains: {left:?}");
    assert!(fake.deleted.lock().unwrap().contains(&old.media_key), "its stored file is deleted");
    assert_eq!(owned_counts(&store, &live.pid).await, live_before, "a live project is untouched");
    assert_eq!(owned_counts(&store, &trashed.pid).await, trashed_before, "a trashed project is untouched");
    let l = ok(&router, &format!("{TRASH}/ListDeletedProjects"), &ta, json!({})).await;
    assert!(arr(&l, "projects").iter().any(|x| s(x, "id") == trashed.pid), "the trashed project is still in the trash");
    ok(&router, &format!("{TASK}/GetTask"), &token(&member), json!({ "id": live.task })).await;
    // Running it again finds nothing of ours to do.
    ok(&router, &format!("{TRASH}/PurgeLeftovers"), &ta, json!({})).await;
    assert_eq!(owned_counts(&store, &live.pid).await, live_before);
}

#[tokio::test]
async fn a_trashed_project_is_read_only_even_for_admins() {
    let Some((router, store, fake)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, member, admin) = (mk_user(&store).await, mk_user(&store).await, mk_user(&store).await);
    let (to, ta) = (token(&owner), admin_token(&admin));
    let r = rich(&router, &fake, &owner, &member).await;
    ok(&router, &format!("{PROJECT}/DeleteProject"), &to, json!({ "id": r.pid })).await;
    let before = owned_counts(&store, &r.pid).await;
    let mut leaked = Vec::new();
    for (path, body) in [
        (format!("{MODULE}/CreateModule"), json!({ "projectId": r.pid, "name": "x" })),
        (format!("{MODULE}/UpdateModule"), json!({ "id": r.module, "name": "renamed" })),
        (format!("{MODULE}/ReorderModules"), json!({ "projectId": r.pid, "moduleIds": [r.module] })),
        (format!("{PROJECT}/SetProjectStatus"), json!({ "id": r.pid, "status": "PROJECT_STATUS_COMPLETED" })),
        (format!("{PROJECT}/TransferProjectOwnership"), json!({ "id": r.pid, "newOwnerId": member })),
        (format!("{PROJECT}/AddProjectMember"), json!({ "projectId": r.pid, "userId": admin })),
        (format!("{PROJECT}/RemoveProjectMember"), json!({ "projectId": r.pid, "userId": member })),
        (format!("{PROJECT}/SetProjectTemplate"), json!({ "id": r.pid, "isTemplate": true })),
        ("/sedjiwa.tasks.work.v1.TaskStatusService/CreateTaskStatus".to_string(), json!({ "projectId": r.pid, "name": "x", "color": "#111111", "category": "TODO" })),
        (format!("{LABEL}/CreateLabel"), json!({ "projectId": r.pid, "name": "y", "color": "#222222" })),
        (format!("{PAGE}/CreatePage"), json!({ "projectId": r.pid, "title": "y" })),
        (format!("{VIEW}/CreateSavedView"), json!({ "projectId": r.pid, "name": "y", "query": "" })),
        (format!("{MEDIA}/CreateMediaUpload"), json!({ "projectId": r.pid, "fileName": "b.png", "mimeType": "image/png", "size": 5 })),
        (format!("{TPL}/SaveTaskTemplate"), json!({ "taskId": r.task, "name": "y" })),
        (format!("{AUTO}/CreateAutomation"), json!({ "projectId": r.pid, "name": "y", "mode": "AUTOMATION_MODE_ON", "trigger": { "taskCreated": {} }, "actions": [{ "comment": "z" }] })),
        (format!("{AUTO}/SetAutomationMode"), json!({ "id": r.rule, "mode": "AUTOMATION_MODE_OFF" })),
        (format!("{WORK}/SetWorkCalendar"), json!({ "scope": "CALENDAR_SCOPE_PROJECT", "id": r.pid, "workingDays": [1] })),
        (format!("{TASK}/BulkUpdateTasks"), json!({ "taskIds": [r.task], "priority": "LOW" })),
        (format!("{COMMENT}/DeleteComment"), json!({ "id": r.comment })),
        (format!("{MEDIA}/DeleteMediaFile"), json!({ "mediaFileId": r.media })),
        (format!("{TIME}/DeleteTimeEntry"), json!({ "id": r.entry })),
        (format!("{PAGE}/DeletePage"), json!({ "id": r.page })),
        (format!("{LABEL}/DeleteLabel"), json!({ "id": r.label })),
        (format!("{VIEW}/DeleteSavedView"), json!({ "id": r.view })),
        (format!("{TPL}/DeleteTaskTemplate"), json!({ "id": r.template })),
        (format!("{AUTO}/DeleteAutomation"), json!({ "id": r.rule })),
        (format!("{TASK}/DeleteTask"), json!({ "id": r.sub })),
        (format!("{MODULE}/DeleteModule"), json!({ "id": r.module })),
    ] {
        let (st, v) = call(&router, &path, Some(&ta), body).await;
        if st == StatusCode::OK || v["code"] != "not_found" {
            leaked.push(format!("{path} -> {st}"));
        }
    }
    assert!(leaked.is_empty(), "an admin changed a trashed project through: {leaked:#?}");
    assert_eq!(owned_counts(&store, &r.pid).await, before, "and no row of it changed");
    assert!(!fake.deleted.lock().unwrap().contains(&r.media_key), "its stored file is still there");
}
