//! End-to-end project templates (mark, list, copy with date shift) and task
//! templates (save, use, delete) over the real Connect routers + Postgres.
//! Skipped unless `DATABASE_URL` is set.

use std::sync::Arc;

use auth::{sign_jwt, verify_jwt};
use axum::body::{to_bytes, Body};
use axum::extract::Request;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::StatusCode;
use axum::middleware::{from_fn, Next};
use axum::response::Response;
use axum::Router;
use domain::project::ProjectDates;
use domain::user::{UserPassword, UserPhone, UserProfile, UserStatusComponent};
use persistence::Store;
use serde_json::{json, Value};
use tower::ServiceExt;

const SECRET: &str = "test-secret";
const PROJECT: &str = "/sedjiwa.tasks.project.v1.ProjectService";
const MODULE: &str = "/sedjiwa.tasks.work.v1.ModuleService";
const TASK: &str = "/sedjiwa.tasks.work.v1.TaskService";
const STATUS: &str = "/sedjiwa.tasks.work.v1.TaskStatusService";
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
    let store = Arc::new(Store::connect(&url).await.unwrap());
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
        .layer(from_fn(auth_mw));
    Some((router, store))
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

/// Expect a non-OK reply carrying `code`.
async fn fails(router: &Router, path: &str, tok: &str, body: Value, code: &str) {
    let (st, v) = call(router, path, Some(tok), body).await;
    assert_ne!(st, StatusCode::OK, "{path} should fail: {v}");
    assert_eq!(v["code"], code, "{path}: {v}");
}

fn num(body: &Value, key: &str) -> i64 {
    body[key].as_i64().unwrap_or(0)
}

fn s(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or_default().to_string()
}

fn arr<'a>(v: &'a Value, key: &str) -> Vec<&'a Value> {
    v[key].as_array().map(|a| a.iter().collect()).unwrap_or_default()
}

/// Subtask titles of a template (`subtasks: [{ "title": … }]`).
fn sub_titles(tpl: &Value) -> Vec<String> {
    arr(tpl, "subtasks").iter().map(|x| {
        assert!(x.is_object(), "subtasks travel as objects: {x}");
        s(x, "title")
    }).collect()
}

fn strs(v: &Value, key: &str) -> Vec<String> {
    arr(v, key).iter().map(|x| x.as_str().unwrap_or_default().to_string()).collect()
}

async fn mk_user(store: &Store) -> String {
    let now = "2026-01-01T00:00:00Z".to_string();
    store
        .create((
            UserPhone { value: format!("t{}", uniq()), verified: true },
            UserPassword { hash: "x".into(), changed_at: now.clone() },
            UserProfile { display_name: "T".into(), avatar_url: String::new(), email: String::new() },
            UserStatusComponent { status: "active".into(), created_at: now, last_login_at: None },
        ))
        .await
        .unwrap()
        .to_string()
}

async fn project_with(router: &Router, owner: &str, members: &[&str]) -> String {
    let p = ok(router, &format!("{PROJECT}/CreateProject"), &token(owner), json!({ "name": format!("P{}", uniq()) })).await;
    let id = s(&p, "id");
    for m in members {
        ok(router, &format!("{PROJECT}/AddProjectMember"), &token(owner), json!({ "projectId": id, "userId": m })).await;
    }
    id
}

async fn module(router: &Router, tok: &str, project: &str, name: &str, desc: Option<&str>) -> String {
    let mut b = json!({ "projectId": project, "name": name });
    if let Some(d) = desc {
        b["description"] = json!(d);
    }
    s(&ok(router, &format!("{MODULE}/CreateModule"), tok, b).await, "id")
}

async fn task(router: &Router, tok: &str, module: &str, body: Value) -> Value {
    let mut b = json!({ "moduleId": module });
    b.as_object_mut().unwrap().extend(body.as_object().unwrap().clone());
    ok(router, &format!("{TASK}/CreateTask"), tok, b).await
}

async fn get_task(router: &Router, tok: &str, id: &str) -> Value {
    ok(router, &format!("{TASK}/GetTask"), tok, json!({ "id": id })).await
}

async fn tasks_of(router: &Router, tok: &str, project: &str) -> Vec<Value> {
    let v = ok(router, &format!("{TASK}/ListTasks"), tok, json!({ "projectId": project })).await;
    v["tasks"].as_array().cloned().unwrap_or_default()
}

fn by_title<'a>(tasks: &'a [Value], title: &str) -> &'a Value {
    tasks.iter().find(|t| t["title"] == title).unwrap_or_else(|| panic!("no task {title}"))
}

async fn copy(router: &Router, tok: &str, src: &str, extra: Value) -> Value {
    let mut b = json!({ "name": format!("Copy {}", uniq()), "fromProjectId": src });
    b.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    ok(router, &format!("{PROJECT}/CreateProject"), tok, b).await
}

async fn list_projects(router: &Router, tok: &str, templates: bool) -> Vec<String> {
    let v = ok(router, &format!("{PROJECT}/ListProjects"), tok, json!({ "templates": templates, "limit": 200 })).await;
    arr(&v, "projects").iter().map(|p| s(p, "id")).collect()
}

// ── Project templates ────────────────────────────────────────────────────────

#[tokio::test]
async fn template_rpcs_require_a_token() {
    let Some((router, _store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    for (path, body) in [
        (format!("{PROJECT}/SetProjectTemplate"), json!({ "id": "1", "isTemplate": true })),
        (format!("{TPL}/ListTaskTemplates"), json!({ "projectId": "1" })),
        (format!("{TPL}/SaveTaskTemplate"), json!({ "taskId": "1", "name": "x" })),
        (format!("{TPL}/DeleteTaskTemplate"), json!({ "id": "1" })),
        (format!("{TPL}/CreateTaskFromTemplate"), json!({ "templateId": "1", "moduleId": "1" })),
    ] {
        let (st, v) = call(&router, &path, None, body).await;
        assert_ne!(st, StatusCode::OK, "{path} without a token must fail");
        assert_eq!(v["code"], "unauthenticated", "{path} without a token: {v}");
    }
}

#[tokio::test]
async fn marking_a_template_is_owner_or_admin_and_lists_split_by_kind() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, member, outsider, admin) =
        (mk_user(&store).await, mk_user(&store).await, mk_user(&store).await, mk_user(&store).await);
    let (to, tm) = (token(&owner), token(&member));
    let pid = project_with(&router, &owner, &[&member]).await;
    let set = format!("{PROJECT}/SetProjectTemplate");

    assert!(list_projects(&router, &tm, false).await.contains(&pid), "a plain project lists by default");
    fails(&router, &set, &tm, json!({ "id": pid, "isTemplate": true }), "permission_denied").await;
    fails(&router, &set, &token(&outsider), json!({ "id": pid, "isTemplate": true }), "permission_denied").await;
    fails(&router, &set, &to, json!({ "id": "999999999999", "isTemplate": true }), "not_found").await;
    fails(&router, &set, &to, json!({ "id": "abc", "isTemplate": true }), "not_found").await;

    let p = ok(&router, &set, &to, json!({ "id": pid, "isTemplate": true })).await;
    assert_eq!(p["isTemplate"], true, "the reply shows the mark");
    let got = ok(&router, &format!("{PROJECT}/GetProject"), &tm, json!({ "id": pid })).await;
    assert_eq!(got["isTemplate"], true, "a follow-up read shows the mark");
    assert!(!list_projects(&router, &tm, false).await.contains(&pid), "templates leave the default list");
    let templates = list_projects(&router, &tm, true).await;
    assert!(templates.contains(&pid), "templates=true lists it");
    let plain = project_with(&router, &member, &[]).await;
    assert!(!templates.contains(&plain), "templates=true lists templates only");
    assert!(!list_projects(&router, &token(&outsider), true).await.contains(&pid), "membership still scopes templates");

    // An admin who is not a member can unmark it.
    let p = ok(&router, &set, &admin_token(&admin), json!({ "id": pid, "isTemplate": false })).await;
    assert!(p["isTemplate"].is_null() || p["isTemplate"] == false);
    assert!(list_projects(&router, &tm, false).await.contains(&pid), "unmarked, it is a project again");
}

/// A source project with every kind of thing a copy should or should not bring.
struct Source {
    pid: String,
    labels: Vec<(String, String)>, // (id, name)
    a: String,
    b: String,
    c: String,
}

async fn rich_source(router: &Router, store: &Store, owner: &str, member: &str) -> Source {
    let to = token(owner);
    let pid = project_with(router, owner, &[member]).await;
    // A custom status between To Do and In Progress.
    ok(router, &format!("{STATUS}/CreateTaskStatus"), &to,
        json!({ "projectId": pid, "name": "Review", "color": "#AA00AA", "category": "IN_PROGRESS" })).await;
    let l1 = ok(router, &format!("{LABEL}/CreateLabel"), &to, json!({ "projectId": pid, "name": "frontend", "color": "#112233" })).await;
    let l2 = ok(router, &format!("{LABEL}/CreateLabel"), &to, json!({ "projectId": pid, "name": "backend", "color": "#445566" })).await;
    let m1 = module(router, &to, &pid, "Design", Some("look and feel")).await;
    let m2 = module(router, &to, &pid, "Build", None).await;
    let a = task(router, &to, &m1, json!({
        "title": "A design", "description": "<p>spec</p>", "priority": "HIGH", "estimateMinutes": 90,
        "labelIds": [s(&l1, "id"), s(&l2, "id")], "assigneeIds": [member],
        "startDate": "2026-03-02", "dueDate": "2026-03-05"
    })).await;
    let a_id = s(&a, "id");
    let b = task(router, &to, &m1, json!({ "title": "B sub", "parentId": a_id, "dueDate": "2026-03-04" })).await;
    let x = task(router, &to, &m2, json!({ "title": "X cancelled", "status": "CANCELLED" })).await;
    task(router, &to, &m2, json!({ "title": "Y child of cancelled", "parentId": s(&x, "id") })).await;
    task(router, &to, &m2, json!({ "title": "Z cancelled sub", "parentId": a_id, "status": "CANCELLED" })).await;
    let c = task(router, &to, &m2, json!({ "title": "C build", "dueDate": "2026-03-10" })).await;
    ok(router, &format!("{TASK}/UpdateTask"), &to,
        json!({ "id": s(&c, "id"), "blockedByIds": { "values": [a_id, s(&x, "id")] } })).await;
    ok(router, &format!("{TASK}/UpdateTask"), &to, json!({ "id": a_id, "status": "DONE" })).await;
    ok(router, &format!("{COMMENT}/CreateComment"), &to, json!({ "taskId": a_id, "content": "a comment" })).await;
    ok(router, &format!("{TIME}/LogTime"), &to, json!({ "taskId": a_id, "minutes": 30 })).await;
    ok(router, &format!("{WORK}/SetWorkCalendar"), &to,
        json!({ "scope": "CALENDAR_SCOPE_PROJECT", "id": pid, "workingDays": [1, 2, 3] })).await;
    let _ = store;
    Source {
        pid,
        labels: vec![(s(&l1, "id"), "frontend".into()), (s(&l2, "id"), "backend".into())],
        a: a_id,
        b: s(&b, "id"),
        c: s(&c, "id"),
    }
}

#[tokio::test]
async fn a_copy_brings_structure_and_leaves_people_and_history_behind() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, member, copier) = (mk_user(&store).await, mk_user(&store).await, mk_user(&store).await);
    let to = token(&owner);
    let src = rich_source(&router, &store, &owner, &member).await;
    ok(&router, &format!("{PROJECT}/AddProjectMember"), &to, json!({ "projectId": src.pid, "userId": copier })).await;
    let tc = token(&copier);
    let src_tasks_before = tasks_of(&router, &to, &src.pid).await.len();

    let marker = format!("Copy{}", uniq());
    let p = ok(&router, &format!("{PROJECT}/CreateProject"), &tc,
        json!({ "name": marker, "fromProjectId": src.pid })).await;
    let dst = s(&p, "id");
    assert_ne!(dst, src.pid);
    assert!(p["isTemplate"].is_null() || p["isTemplate"] == false, "a copy is a normal project");
    assert_eq!(p["ownerId"], copier.as_str(), "the owner defaults to the caller");
    assert!(p["startDate"].is_null(), "without start_date no project dates are invented");
    let members = ok(&router, &format!("{PROJECT}/ListProjectMembers"), &tc, json!({ "projectId": dst })).await;
    let ids: Vec<String> = arr(&members, "members").iter().map(|m| s(m, "userId")).collect();
    assert_eq!(ids, vec![copier.clone()], "only the caller is a member of the copy: {members}");

    // Statuses: same names, colours, categories and order; new ids.
    let st = |pid: String| {
        let router = router.clone();
        let tc = tc.clone();
        async move { ok(&router, &format!("{STATUS}/ListTaskStatuses"), &tc, json!({ "projectId": pid })).await }
    };
    let (ss, ds) = (st(src.pid.clone()).await, st(dst.clone()).await);
    let shape = |v: &Value| -> Vec<(String, String, String, i64)> {
        arr(v, "statuses").iter().map(|x| (s(x, "name"), s(x, "color"), s(x, "category"), num(x, "order"))).collect()
    };
    assert_eq!(shape(&ss), shape(&ds), "statuses copied in order");
    assert!(shape(&ds).iter().any(|x| x.0 == "Review"), "custom statuses come along");
    let src_status_ids = strs(&json!({ "x": arr(&ss, "statuses").iter().map(|x| s(x, "id")).collect::<Vec<_>>() }), "x");
    let first_todo = arr(&ds, "statuses").iter().find(|x| x["category"] == "TODO").map(|x| s(x, "id")).unwrap();
    assert!(!src_status_ids.contains(&first_todo), "the copy has its own status rows");

    // Labels: same names and colours, new ids.
    let labels = ok(&router, &format!("{LABEL}/ListLabels"), &tc, json!({ "projectId": dst })).await;
    let mut names: Vec<(String, String)> = arr(&labels, "labels").iter().map(|l| (s(l, "name"), s(l, "color"))).collect();
    names.sort();
    assert_eq!(names, vec![("backend".into(), "#445566".into()), ("frontend".into(), "#112233".into())]);
    let new_label = |name: &str| arr(&labels, "labels").iter().find(|l| l["name"] == name).map(|l| s(l, "id")).unwrap();
    assert!(src.labels.iter().all(|(id, _)| *id != new_label("frontend")));

    // Modules: names, descriptions, order.
    let mods = ok(&router, &format!("{MODULE}/ListModules"), &tc, json!({ "projectId": dst })).await;
    let ms: Vec<(String, String, i64)> = arr(&mods, "modules").iter().map(|m| (s(m, "name"), s(m, "description"), num(m, "order"))).collect();
    let smods = ok(&router, &format!("{MODULE}/ListModules"), &tc, json!({ "projectId": src.pid })).await;
    let sms: Vec<(String, String, i64)> = arr(&smods, "modules").iter().map(|m| (s(m, "name"), s(m, "description"), num(m, "order"))).collect();
    assert_eq!(ms, sms, "modules copied with description and order");

    // Tasks: the live ones only.
    let dt = tasks_of(&router, &tc, &dst).await;
    let mut titles: Vec<String> = dt.iter().map(|t| s(t, "title")).collect();
    titles.sort();
    assert_eq!(titles, vec!["A design", "B sub", "C build"],
        "cancelled tasks, their subtasks and cancelled subtasks stay behind");
    let st_src = tasks_of(&router, &tc, &src.pid).await;
    let (a, b, c) = (by_title(&dt, "A design"), by_title(&dt, "B sub"), by_title(&dt, "C build"));
    let sa = by_title(&st_src, "A design");
    assert_eq!(a["priority"], "HIGH");
    assert_eq!(a["description"], "<p>spec</p>");
    assert_eq!(num(a, "number"), num(sa, "number"), "task numbers are kept");
    let mut al = strs(a, "labelIds");
    al.sort();
    let mut want = vec![new_label("frontend"), new_label("backend")];
    want.sort();
    assert_eq!(al, want, "labels remapped to the copy's labels");
    let a_full = get_task(&router, &tc, &s(a, "id")).await;
    assert_eq!(num(&a_full, "estimateMinutes"), 90, "estimate copied");
    assert_eq!(num(&a_full, "loggedMinutes"), 0, "time entries stay behind");
    assert!(strs(&a_full, "assigneeIds").is_empty(), "assignees stay behind");
    assert_eq!(b["parentId"], a["id"], "parent link remapped");
    assert_eq!(strs(c, "blockedByIds"), vec![s(a, "id")], "blocked-by remapped, the cancelled blocker dropped");
    for t in &dt {
        assert_eq!(t["status"], "TODO", "{} starts in To Do", t["title"]);
        assert_eq!(s(t, "statusId"), first_todo, "{} sits in the first To Do status", t["title"]);
        assert!(t["completedAt"].is_null(), "{} is not completed", t["title"]);
        assert_eq!(t["createdBy"], copier.as_str(), "{} is created by the copier", t["title"]);
    }
    assert_eq!(a["startDate"], "2026-03-02", "dates stay without start_date");
    assert_eq!(c["dueDate"], "2026-03-10");
    let comments = ok(&router, &format!("{COMMENT}/ListComments"), &tc, json!({ "taskId": s(a, "id") })).await;
    assert!(arr(&comments, "comments").is_empty(), "comments stay behind");

    // Working days.
    let cal = ok(&router, &format!("{WORK}/GetWorkCalendar"), &tc, json!({ "scope": "CALENDAR_SCOPE_PROJECT", "id": dst })).await;
    assert_eq!(cal["workingDays"], json!([1, 2, 3]), "project working days copied");

    // Searchable: the project and its tasks.
    let hits = ok(&router, &format!("{SEARCH}/Search"), &tc, json!({ "q": marker })).await;
    assert!(arr(&hits, "results").iter().any(|r| s(r, "id") == dst), "the copied project is indexed: {hits}");
    let hits = ok(&router, &format!("{SEARCH}/Search"), &tc, json!({ "q": "design", "kinds": ["TASK"], "limit": 50 })).await;
    assert!(arr(&hits, "results").iter().any(|r| s(r, "id") == s(a, "id")), "copied tasks are indexed: {hits}");

    // The source is untouched.
    assert_eq!(tasks_of(&router, &to, &src.pid).await.len(), src_tasks_before, "the source keeps every task");
    let sa = get_task(&router, &to, &src.a).await;
    assert_eq!(sa["status"], "DONE");
    assert_eq!(strs(&sa, "assigneeIds"), vec![member.clone()]);
    assert_eq!(num(&sa, "loggedMinutes"), 30);
    assert_eq!(get_task(&router, &to, &src.b).await["parentId"], src.a.as_str());
    assert_eq!(strs(&get_task(&router, &to, &src.c).await, "blockedByIds").len(), 2);

    // The copy behaves like any project: new tasks number on from the copied ones.
    let m = arr(&mods, "modules")[0]["id"].as_str().unwrap().to_string();
    let fresh = task(&router, &tc, &m, json!({ "title": "after copy" })).await;
    let max = dt.iter().map(|t| num(t, "number")).max().unwrap();
    assert_eq!(num(&fresh, "number"), max + 1, "numbering continues after the copied tasks");
}

#[tokio::test]
async fn start_date_shifts_every_copied_date() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);

    // No project dates: the base is the earliest task date (2026-03-02).
    let src = project_with(&router, &owner, &[]).await;
    let m = module(&router, &to, &src, "M", None).await;
    task(&router, &to, &m, json!({ "title": "first", "startDate": "2026-03-02", "dueDate": "2026-03-05" })).await;
    task(&router, &to, &m, json!({ "title": "later", "dueDate": "2026-03-31" })).await;
    task(&router, &to, &m, json!({ "title": "undated" })).await;
    let p = copy(&router, &to, &src, json!({ "startDate": "2026-11-02" })).await;
    assert_eq!(p["startDate"], "2026-11-02", "the copy starts on the given date");
    assert!(p["endDate"].is_null(), "no source end date, no end date");
    let t = tasks_of(&router, &to, &s(&p, "id")).await;
    assert_eq!(by_title(&t, "first")["startDate"], "2026-11-02", "shifted by 245 days");
    assert_eq!(by_title(&t, "first")["dueDate"], "2026-11-05");
    assert_eq!(by_title(&t, "later")["dueDate"], "2026-12-01", "crosses a month end correctly");
    assert!(by_title(&t, "undated")["dueDate"].is_null(), "undated tasks stay undated");

    // Project dates set: the base is the project's start, and the end moves too.
    let src2 = project_with(&router, &owner, &[]).await;
    store
        .attach(src2.parse().unwrap(), ProjectDates { start_date: Some("2026-03-01".into()), end_date: Some("2026-03-31".into()) })
        .await
        .unwrap();
    let m2 = module(&router, &to, &src2, "M", None).await;
    task(&router, &to, &m2, json!({ "title": "t", "startDate": "2026-03-02", "dueDate": "2026-03-05" })).await;
    let p = copy(&router, &to, &src2, json!({ "startDate": "2026-04-01" })).await;
    assert_eq!(p["startDate"], "2026-04-01");
    assert_eq!(p["endDate"], "2026-05-01", "the end shifts by the same 31 days");
    let t = tasks_of(&router, &to, &s(&p, "id")).await;
    assert_eq!(by_title(&t, "t")["startDate"], "2026-04-02", "shifted from the project's start, not the task's");
    assert_eq!(by_title(&t, "t")["dueDate"], "2026-04-05");

    // Moving backwards works too.
    let p = copy(&router, &to, &src2, json!({ "startDate": "2026-02-01" })).await;
    let t = tasks_of(&router, &to, &s(&p, "id")).await;
    assert_eq!(by_title(&t, "t")["startDate"], "2026-02-02", "a negative shift (−28 days)");
    assert_eq!(by_title(&t, "t")["dueDate"], "2026-02-05");
    assert_eq!(p["endDate"], "2026-03-03");

    // A source with no dates at all: nothing to shift, the start still applies.
    let empty = project_with(&router, &owner, &[]).await;
    let p = copy(&router, &to, &empty, json!({ "startDate": "2026-05-05" })).await;
    assert_eq!(p["startDate"], "2026-05-05");
    assert!(tasks_of(&router, &to, &s(&p, "id")).await.is_empty(), "an empty source gives an empty copy");
}

#[tokio::test]
async fn copying_needs_access_to_the_source_and_valid_input() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, outsider, admin, other) =
        (mk_user(&store).await, mk_user(&store).await, mk_user(&store).await, mk_user(&store).await);
    let to = token(&owner);
    let src = project_with(&router, &owner, &[]).await;
    let m = module(&router, &to, &src, "M", None).await;
    task(&router, &to, &m, json!({ "title": "secret task" })).await;
    let create = format!("{PROJECT}/CreateProject");

    fails(&router, &create, &token(&outsider), json!({ "name": "steal", "fromProjectId": src }), "permission_denied").await;
    fails(&router, &create, &to, json!({ "name": "x", "fromProjectId": "999999999999" }), "not_found").await;
    fails(&router, &create, &to, json!({ "name": "x", "fromProjectId": "abc" }), "not_found").await;
    for bad in ["2026-13-01", "01-02-2026", "2026-02-30"] {
        fails(&router, &create, &to, json!({ "name": "x", "fromProjectId": src, "startDate": bad }), "invalid_argument").await;
    }
    fails(&router, &create, &to, json!({ "name": "  ", "fromProjectId": src }), "invalid_argument").await;

    // An admin who is not a member may copy.
    let p = copy(&router, &admin_token(&admin), &src, json!({})).await;
    assert_eq!(tasks_of(&router, &admin_token(&admin), &s(&p, "id")).await.len(), 1);

    // Copying a template gives a normal project; owner_id hands it to someone else.
    ok(&router, &format!("{PROJECT}/SetProjectTemplate"), &to, json!({ "id": src, "isTemplate": true })).await;
    let p = copy(&router, &to, &src, json!({ "ownerId": other })).await;
    assert!(p["isTemplate"].is_null() || p["isTemplate"] == false, "a template's copy is not a template");
    assert_eq!(p["ownerId"], other.as_str(), "owner_id sets the owner");
    let members = ok(&router, &format!("{PROJECT}/ListProjectMembers"), &to, json!({ "projectId": s(&p, "id") })).await;
    let ids: Vec<String> = arr(&members, "members").iter().map(|m| s(m, "userId")).collect();
    assert!(ids.contains(&owner), "the caller is a member of the copy: {members}");
    assert!(ids.contains(&other), "and so is the owner: {members}");
    assert!(list_projects(&router, &to, false).await.contains(&s(&p, "id")), "the copy lists as a project");
}

#[tokio::test]
async fn workload_leaves_template_projects_out() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, member) = (mk_user(&store).await, mk_user(&store).await);
    let to = token(&owner);
    let pid = project_with(&router, &owner, &[&member]).await;
    let m = module(&router, &to, &pid, "M", None).await;
    task(&router, &to, &m, json!({ "title": "planned", "assigneeIds": [member], "estimateMinutes": 120 })).await;
    let wl = |project: Option<&str>| {
        let mut b = json!({ "today": "2026-10-21", "weeks": 2 });
        if let Some(p) = project {
            b["projectId"] = json!(p);
        }
        b
    };
    let total = |w: &Value| -> i64 {
        arr(w, "members").iter().find(|r| r["userId"] == member.as_str()).map(|r| num(r, "totalMinutes")).unwrap_or(0)
    };
    let w = ok(&router, &format!("{WORK}/GetWorkload"), &to, wl(Some(&pid))).await;
    assert_eq!(total(&w), 120, "a normal project's work counts");

    ok(&router, &format!("{PROJECT}/SetProjectTemplate"), &to, json!({ "id": pid, "isTemplate": true })).await;
    let w = ok(&router, &format!("{WORK}/GetWorkload"), &to, wl(Some(&pid))).await;
    assert_eq!(total(&w), 0, "a template's tasks are not anyone's work");
    let w = ok(&router, &format!("{WORK}/GetWorkload"), &token(&member), wl(None)).await;
    assert!(arr(&w, "projects").iter().all(|p| s(p, "id") != pid), "nor is the template a workload project");
    assert_eq!(total(&w), 0);
}

// ── Task templates ───────────────────────────────────────────────────────────

#[tokio::test]
async fn task_templates_snapshot_a_task_and_recreate_it() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, member, outsider) = (mk_user(&store).await, mk_user(&store).await, mk_user(&store).await);
    let (to, tm, tx) = (token(&owner), token(&member), token(&outsider));
    let pid = project_with(&router, &owner, &[&member]).await;
    let m = module(&router, &to, &pid, "Ops", None).await;
    let m2 = module(&router, &to, &pid, "Other", None).await;
    let l1 = s(&ok(&router, &format!("{LABEL}/CreateLabel"), &to, json!({ "projectId": pid, "name": "bug", "color": "#ff0000" })).await, "id");
    let l2 = s(&ok(&router, &format!("{LABEL}/CreateLabel"), &to, json!({ "projectId": pid, "name": "ops", "color": "#00ff00" })).await, "id");
    let src = task(&router, &to, &m, json!({
        "title": "Release", "description": "<p>checklist</p>", "priority": "URGENT", "estimateMinutes": 45,
        "labelIds": [l1, l2], "assigneeIds": [member], "dueDate": "2026-01-01"
    })).await;
    let sid = s(&src, "id");
    for t in ["Tag", "Build", "Announce"] {
        task(&router, &to, &m, json!({ "title": t, "parentId": sid })).await;
    }
    let save = format!("{TPL}/SaveTaskTemplate");

    // Name validation and access.
    for bad in [json!(""), json!("   "), json!("n".repeat(81))] {
        fails(&router, &save, &tm, json!({ "taskId": sid, "name": bad }), "invalid_argument").await;
    }
    fails(&router, &save, &tx, json!({ "taskId": sid, "name": "x" }), "permission_denied").await;
    fails(&router, &save, &tm, json!({ "taskId": "999999999999", "name": "x" }), "not_found").await;
    ok(&router, &save, &tm, json!({ "taskId": sid, "name": "é".repeat(80) })).await;

    let tpl = ok(&router, &save, &tm, json!({ "taskId": sid, "name": "  Release checklist  " })).await;
    let tid = s(&tpl, "id");
    assert_eq!(tpl["name"], "Release checklist", "the name is trimmed");
    assert_eq!(tpl["title"], "Release");
    assert_eq!(tpl["description"], "<p>checklist</p>");
    assert_eq!(tpl["priority"], "URGENT");
    assert_eq!(num(&tpl, "estimateMinutes"), 45);
    let mut ls = strs(&tpl, "labelIds");
    ls.sort();
    let mut want = vec![l1.clone(), l2.clone()];
    want.sort();
    assert_eq!(ls, want);
    assert_eq!(sub_titles(&tpl), vec!["Tag", "Build", "Announce"], "subtask titles in order");
    assert_eq!(tpl["createdBy"], member.as_str());
    assert_eq!(tpl["projectId"], pid.as_str());

    let list = format!("{TPL}/ListTaskTemplates");
    let l = ok(&router, &list, &to, json!({ "projectId": pid })).await;
    assert!(arr(&l, "templates").iter().any(|t| s(t, "id") == tid), "members list the project's templates");
    fails(&router, &list, &tx, json!({ "projectId": pid }), "permission_denied").await;

    // Use it: title override, assignees and due date; a deleted label drops out.
    ok(&router, &format!("{LABEL}/DeleteLabel"), &to, json!({ "id": l2 })).await;
    let use_ = format!("{TPL}/CreateTaskFromTemplate");
    let made = ok(&router, &use_, &tm, json!({
        "templateId": tid, "moduleId": m2, "title": "  Release 2.0 ", "assigneeIds": [owner], "dueDate": "2026-12-01"
    })).await;
    assert_eq!(made["title"], "Release 2.0", "the title override is trimmed");
    assert_eq!(made["moduleId"], m2.as_str());
    assert_eq!(made["priority"], "URGENT");
    assert_eq!(made["description"], "<p>checklist</p>");
    assert_eq!(strs(&made, "labelIds"), vec![l1.clone()], "a deleted label is dropped");
    assert_eq!(strs(&made, "assigneeIds"), vec![owner.clone()]);
    assert_eq!(made["dueDate"], "2026-12-01");
    assert_eq!(made["createdBy"], member.as_str(), "created as the caller");
    assert_eq!(made["status"], "TODO");
    let full = get_task(&router, &tm, &s(&made, "id")).await;
    assert_eq!(num(&full, "estimateMinutes"), 45);
    let subs: Vec<Value> = tasks_of(&router, &tm, &pid)
        .await
        .into_iter()
        .filter(|t| t["parentId"] == made["id"])
        .collect();
    let mut sub_titles: Vec<(i64, String)> = subs.iter().map(|t| (num(t, "order"), s(t, "title"))).collect();
    sub_titles.sort();
    assert_eq!(sub_titles.iter().map(|x| x.1.clone()).collect::<Vec<_>>(), vec!["Tag", "Build", "Announce"],
        "one subtask per saved title, in order");
    assert!(subs.iter().all(|t| t["moduleId"] == m2.as_str()), "subtasks land in the same module");

    // Without overrides: the template's own title, no assignees, no due date.
    let plain = ok(&router, &use_, &to, json!({ "templateId": tid, "moduleId": m })).await;
    assert_eq!(plain["title"], "Release");
    assert!(strs(&plain, "assigneeIds").is_empty());
    assert!(plain["dueDate"].is_null());

    // It goes through the normal create: activity and search.
    let act = ok(&router, &format!("{ACTIVITY}/ListEntityActivity"), &to,
        json!({ "entityType": "TASK", "entityId": s(&made, "id") })).await;
    assert!(arr(&act, "activities").iter().any(|a| a["action"] == "CREATED") || arr(&act, "items").iter().any(|a| a["action"] == "CREATED"),
        "creating from a template leaves a created activity: {act}");
    let hits = ok(&router, &format!("{SEARCH}/Search"), &to, json!({ "q": "Release 2.0", "kinds": ["TASK"] })).await;
    assert!(arr(&hits, "results").iter().any(|r| s(r, "id") == s(&made, "id")), "and is searchable: {hits}");

    // Bad targets.
    let other = project_with(&router, &owner, &[]).await;
    let om = module(&router, &to, &other, "M", None).await;
    fails(&router, &use_, &to, json!({ "templateId": tid, "moduleId": om }), "invalid_argument").await;
    fails(&router, &use_, &to, json!({ "templateId": "999999999999", "moduleId": m }), "not_found").await;
    fails(&router, &use_, &to, json!({ "templateId": tid, "moduleId": "999999999999" }), "not_found").await;
    fails(&router, &use_, &tx, json!({ "templateId": tid, "moduleId": m }), "permission_denied").await;
    fails(&router, &use_, &to, json!({ "templateId": tid, "moduleId": m, "dueDate": "2026-02-30" }), "invalid_argument").await;
}

#[tokio::test]
async fn a_task_template_keeps_at_most_fifty_subtasks() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);
    let pid = project_with(&router, &owner, &[]).await;
    let m = module(&router, &to, &pid, "M", None).await;
    let parent = s(&task(&router, &to, &m, json!({ "title": "Big" })).await, "id");
    for i in 0..52 {
        task(&router, &to, &m, json!({ "title": format!("s{i:02}"), "parentId": parent })).await;
    }
    let tpl = ok(&router, &format!("{TPL}/SaveTaskTemplate"), &to, json!({ "taskId": parent, "name": "big" })).await;
    let subs = sub_titles(&tpl);
    assert_eq!(subs.len(), 50, "capped at 50");
    assert_eq!(subs.first().map(String::as_str), Some("s00"));
    assert_eq!(subs.last().map(String::as_str), Some("s49"), "the first 50 in order");
    let stored: String = sqlx::query_scalar("SELECT subtasks::text FROM cmp_tasktemplate WHERE pid = $1")
        .bind(s(&tpl, "id").parse::<i64>().unwrap())
        .fetch_one(store.pool())
        .await
        .unwrap();
    assert!(stored.starts_with(r#"[{"title": "s00"}, {"title": "s01"}"#), "stored as ordered objects: {stored}");
}

#[tokio::test]
async fn task_templates_are_deleted_by_author_owner_or_admin() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, a, b, admin) = (mk_user(&store).await, mk_user(&store).await, mk_user(&store).await, mk_user(&store).await);
    let (to, ta, tb) = (token(&owner), token(&a), token(&b));
    let pid = project_with(&router, &owner, &[&a, &b]).await;
    let m = module(&router, &to, &pid, "M", None).await;
    let t = s(&task(&router, &to, &m, json!({ "title": "T" })).await, "id");
    let save = |tok: String, name: &'static str| {
        let router = router.clone();
        let t = t.clone();
        async move { s(&ok(&router, &format!("{TPL}/SaveTaskTemplate"), &tok, json!({ "taskId": t, "name": name })).await, "id") }
    };
    let del = format!("{TPL}/DeleteTaskTemplate");
    let (t1, t2, t3) = (save(ta.clone(), "one").await, save(ta.clone(), "two").await, save(ta.clone(), "three").await);

    fails(&router, &del, &tb, json!({ "id": t1 }), "permission_denied").await;
    fails(&router, &del, &to, json!({ "id": "999999999999" }), "not_found").await;
    ok(&router, &del, &ta, json!({ "id": t1 })).await;
    ok(&router, &del, &to, json!({ "id": t2 })).await;
    ok(&router, &del, &admin_token(&admin), json!({ "id": t3 })).await;
    let l = ok(&router, &format!("{TPL}/ListTaskTemplates"), &to, json!({ "projectId": pid })).await;
    assert!(arr(&l, "templates").is_empty(), "all three are gone: {l}");
    fails(&router, &del, &ta, json!({ "id": t1 }), "not_found").await;
    fails(&router, &format!("{TPL}/CreateTaskFromTemplate"), &ta, json!({ "templateId": t1, "moduleId": m }), "not_found").await;
}

#[tokio::test]
async fn trashing_a_project_hides_its_task_templates_until_purge() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);
    let pid = project_with(&router, &owner, &[]).await;
    let m = module(&router, &to, &pid, "M", None).await;
    let t = s(&task(&router, &to, &m, json!({ "title": "T" })).await, "id");
    let tid = s(&ok(&router, &format!("{TPL}/SaveTaskTemplate"), &to, json!({ "taskId": t, "name": "keep?" })).await, "id");
    ok(&router, &format!("{PROJECT}/SetProjectTemplate"), &to, json!({ "id": pid, "isTemplate": true })).await;
    ok(&router, &format!("{PROJECT}/DeleteProject"), &to, json!({ "id": pid })).await;
    // In the trash: nothing of it is reachable…
    fails(&router, &format!("{TPL}/ListTaskTemplates"), &to, json!({ "projectId": pid }), "not_found").await;
    fails(&router, &format!("{TPL}/CreateTaskFromTemplate"), &to, json!({ "templateId": tid, "moduleId": m }), "not_found").await;
    assert!(!list_projects(&router, &to, true).await.contains(&pid), "a trashed template is not offered as a template");
    // …but its rows are kept for a restore (the purge is covered in trash_flow).
    let marks: i64 = sqlx::query_scalar("SELECT count(*) FROM cmp_projecttemplatemark WHERE pid = $1")
        .bind(pid.parse::<i64>().unwrap())
        .fetch_one(store.pool())
        .await
        .unwrap();
    assert_eq!(marks, 1, "the template mark is kept while trashed");
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM cmp_tasktemplate WHERE project_id = $1")
        .bind(&pid)
        .fetch_one(store.pool())
        .await
        .unwrap();
    assert_eq!(left, 1, "the task template is kept while trashed");
}

#[tokio::test]
async fn templates_saved_with_plain_string_subtasks_still_work() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);
    let pid = project_with(&router, &owner, &[]).await;
    let m = module(&router, &to, &pid, "M", None).await;
    let t = s(&task(&router, &to, &m, json!({ "title": "Old style" })).await, "id");
    let tpl = ok(&router, &format!("{TPL}/SaveTaskTemplate"), &to, json!({ "taskId": t, "name": "legacy" })).await;
    let tid = s(&tpl, "id");
    // New rows store ordered objects…
    let stored: String = sqlx::query_scalar("SELECT subtasks::text FROM cmp_tasktemplate WHERE pid = $1")
        .bind(tid.parse::<i64>().unwrap())
        .fetch_one(store.pool())
        .await
        .unwrap();
    assert_eq!(stored, "[]", "a template without subtasks stores an empty list");
    // …while rows from before the change hold plain strings. Write one directly
    // (there is no Row type for cmp_tasktemplate), plus a mixed one.
    for (shape, want) in [
        (r#"["Third", "First", "Second"]"#, vec!["Third", "First", "Second"]),
        (r#"["plain", {"title": "object"}]"#, vec!["plain", "object"]),
    ] {
        sqlx::query("UPDATE cmp_tasktemplate SET subtasks = $2::jsonb WHERE pid = $1")
            .bind(tid.parse::<i64>().unwrap())
            .bind(shape)
            .execute(store.pool())
            .await
            .unwrap();
        let l = ok(&router, &format!("{TPL}/ListTaskTemplates"), &to, json!({ "projectId": pid })).await;
        let row = arr(&l, "templates").into_iter().find(|x| s(x, "id") == tid).unwrap().clone();
        assert_eq!(sub_titles(&row), want, "{shape} lists as objects, in order");

        let made = ok(&router, &format!("{TPL}/CreateTaskFromTemplate"), &to, json!({ "templateId": tid, "moduleId": m })).await;
        let mut subs: Vec<(i64, String)> = tasks_of(&router, &to, &pid)
            .await
            .iter()
            .filter(|x| x["parentId"] == made["id"])
            .map(|x| (num(x, "order"), s(x, "title")))
            .collect();
        subs.sort();
        assert_eq!(subs.into_iter().map(|x| x.1).collect::<Vec<_>>(), want, "{shape} creates its subtasks in order");
    }
}

// ── Templates are not real work ──────────────────────────────────────────────

/// Task ids in a list of `MyTask` items.
fn my_ids(items: &[&Value]) -> Vec<String> {
    items.iter().map(|i| s(&i["task"], "id")).collect()
}

#[tokio::test]
async fn template_projects_stay_out_of_dashboards_reports_my_tasks_and_search() {
    use base64::Engine;
    use calamine::{Reader, Xlsx};
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (owner, u, admin) = (mk_user(&store).await, mk_user(&store).await, mk_user(&store).await);
    let (to, tu, ta) = (token(&owner), token(&u), admin_token(&admin));
    let marker = format!("scope{}", uniq());
    // T: a template with 3 overdue tasks for U. P: a real project with 1.
    let t = project_with(&router, &owner, &[&u]).await;
    let p = project_with(&router, &owner, &[&u]).await;
    let (tm, pm) = (module(&router, &to, &t, "M", None).await, module(&router, &to, &p, "M", None).await);
    let mut t_tasks = Vec::new();
    for i in 0..3 {
        t_tasks.push(s(&task(&router, &to, &tm, json!({
            "title": format!("{marker} template {i}"), "assigneeIds": [u], "dueDate": format!("2026-01-0{}", i + 2)
        })).await, "id"));
    }
    let p_task = s(&task(&router, &to, &pm, json!({ "title": format!("{marker} real"), "assigneeIds": [u], "dueDate": "2026-01-05" })).await, "id");
    // A far-future pair for the "upcoming" side as well.
    let t_future = s(&task(&router, &to, &tm, json!({ "title": format!("{marker} template future"), "assigneeIds": [u], "dueDate": "2099-01-01" })).await, "id");
    let p_future = s(&task(&router, &to, &pm, json!({ "title": format!("{marker} real future"), "assigneeIds": [u], "dueDate": "2099-01-01" })).await, "id");
    ok(&router, &format!("{PROJECT}/SetProjectTemplate"), &to, json!({ "id": t, "isTemplate": true })).await;
    let t_all: Vec<String> = t_tasks.iter().cloned().chain([t_future.clone()]).collect();

    for (who, tok) in [("member", tu.clone()), ("admin", ta.clone())] {
        // Dashboard stats.
        let d = ok(&router, &format!("{DASH}/GetDashboardStats"), &tok, json!({})).await;
        let per: Vec<String> = arr(&d, "perProject").iter().map(|x| s(x, "projectId")).collect();
        assert!(per.contains(&p), "{who}: the real project is on the dashboard");
        assert!(!per.contains(&t), "{who}: the template is not: {d}");
        if who == "member" {
            assert_eq!(num(&d, "overdueTasks"), 1, "member: only P's overdue task counts: {d}");
            assert_eq!(num(&d, "totalTasks"), 2, "member: only P's tasks count: {d}");
        }

        // Search: neither the template, nor its tasks.
        let hits = ok(&router, &format!("{SEARCH}/Search"), &tok, json!({ "q": marker, "limit": 50 })).await;
        let ids: Vec<String> = arr(&hits, "results").iter().map(|r| s(r, "id")).collect();
        assert!(ids.contains(&p_task), "{who}: P's task is found");
        assert!(t_all.iter().all(|x| !ids.contains(x)), "{who}: no template task is found: {hits}");
        let pname = ok(&router, &format!("{PROJECT}/GetProject"), &to, json!({ "id": t })).await;
        let hits = ok(&router, &format!("{SEARCH}/Search"), &tok, json!({ "q": s(&pname, "name"), "kinds": ["PROJECT"] })).await;
        assert!(arr(&hits, "results").iter().all(|r| s(r, "id") != t), "{who}: the template project is not found: {hits}");

        // Period report (+ xlsx) around today.
        let d0 = time::OffsetDateTime::now_utc().date();
        let (from, to_d) = (d0 - time::Duration::days(7), d0 + time::Duration::days(1));
        let body = json!({
            "periodStart": format!("{from}T00:00:00Z"), "periodEnd": format!("{to_d}T00:00:00Z"),
            "periodStartDate": from.to_string(), "periodEndDate": to_d.to_string(),
        });
        let r = ok(&router, &format!("{REPORT}/GetPeriodReport"), &tok, body.clone()).await;
        let per: Vec<String> = arr(&r, "perProject").iter().map(|x| s(x, "projectId")).collect();
        assert!(per.contains(&p), "{who}: P is in the report");
        assert!(!per.contains(&t), "{who}: T is not in the report: {r}");
        let overdue = my_ids(&arr(&r, "overdueTasks"));
        assert!(overdue.contains(&p_task) || r["overdueTruncated"] == true, "{who}: P's overdue task is listed");
        assert!(t_all.iter().all(|x| !overdue.contains(x)), "{who}: no template task in the overdue list");
        let x = ok(&router, &format!("{REPORT}/ExportPeriodReportXlsx"), &tok, json!({ "report": body, "label": "w", "granularity": "weekly" })).await;
        let bytes = base64::engine::general_purpose::STANDARD.decode(x["xlsx"].as_str().unwrap()).unwrap();
        let mut wb: Xlsx<_> = calamine::open_workbook_from_rs(std::io::Cursor::new(bytes)).unwrap();
        for sheet in wb.sheet_names() {
            let range = wb.worksheet_range(&sheet).unwrap();
            let text: String = range.rows().flat_map(|r| r.iter().map(|c| c.to_string())).collect::<Vec<_>>().join("|");
            assert!(!text.contains(&format!("{marker} template")), "{who}: sheet {sheet} mentions a template task");
        }
    }

    // My tasks (member): assigned and upcoming only show P.
    let mine = ok(&router, &format!("{MINE}/ListAssignedToMe"), &tu, json!({ "pageSize": 100 })).await;
    let ids = my_ids(&arr(&mine, "items"));
    assert_eq!(num(&mine, "total"), 2, "assigned to U: P's two tasks only: {mine}");
    assert!(ids.contains(&p_task) && ids.contains(&p_future));
    let created = ok(&router, &format!("{MINE}/ListCreatedByMe"), &to, json!({ "pageSize": 100 })).await;
    let cids = my_ids(&arr(&created, "items"));
    assert!(t_all.iter().all(|x| !cids.contains(x)), "created by the owner: no template task");
    assert!(cids.contains(&p_task));
    let up = ok(&router, &format!("{DASH}/GetUpcomingDeadlines"), &tu, json!({ "withinDays": 30, "includeOverdue": true })).await;
    let uids = my_ids(&arr(&up, "items"));
    assert!(uids.contains(&p_task), "upcoming/overdue: P's task: {up}");
    assert!(t_all.iter().all(|x| !uids.contains(x)), "upcoming/overdue: no template task");

    // The template itself still works.
    assert_eq!(tasks_of(&router, &tu, &t).await.len(), 4, "opening T lists its tasks");
    let copy = copy(&router, &to, &t, json!({})).await;
    assert_eq!(tasks_of(&router, &to, &s(&copy, "id")).await.len(), 4, "copying T brings its tasks");
}

#[tokio::test]
async fn using_a_template_skips_subtasks_without_a_title() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);
    let pid = project_with(&router, &owner, &[]).await;
    let m = module(&router, &to, &pid, "M", None).await;
    let t = s(&task(&router, &to, &m, json!({ "title": "Edited by hand" })).await, "id");
    let tid = s(&ok(&router, &format!("{TPL}/SaveTaskTemplate"), &to, json!({ "taskId": t, "name": "hand" })).await, "id");
    sqlx::query("UPDATE cmp_tasktemplate SET subtasks = $2::jsonb WHERE pid = $1")
        .bind(tid.parse::<i64>().unwrap())
        .bind(r#"["", "  ", {"name": "no title"}, {"title": ""}, "kept", {"title": "also kept"}]"#)
        .execute(store.pool())
        .await
        .unwrap();
    let made = ok(&router, &format!("{TPL}/CreateTaskFromTemplate"), &to, json!({ "templateId": tid, "moduleId": m })).await;
    let mut subs: Vec<(i64, String)> = tasks_of(&router, &to, &pid)
        .await
        .iter()
        .filter(|x| x["parentId"] == made["id"])
        .map(|x| (num(x, "order"), s(x, "title")))
        .collect();
    subs.sort();
    assert_eq!(subs.into_iter().map(|x| x.1).collect::<Vec<_>>(), vec!["kept", "also kept"],
        "untitled subtasks are skipped instead of failing the whole create");
}
