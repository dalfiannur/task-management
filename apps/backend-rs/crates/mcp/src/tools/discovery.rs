//! Discovery tools: cross-entity search and "what's on my plate". Both are
//! read-only and cross-project, so both rely entirely on the membership
//! filter inside their core fn.

use serde_json::{json, Value};
use transport::api::{
    dashboard_pb, list_assigned_to_me_core, list_created_by_me_core, list_involving_me_core,
    search_core, search_pb,
};

use super::{limit_arg, limit_arg_capped, opt_str, str_arg, truncate, Ctx, ToolError, ToolMeta};

/// Proto `SearchKind` code → model-readable label, the search analogue of
/// `tasks::status_label`. `SearchResult.kind` is a wire enum; every other
/// tool's output follows "enums as strings", and search is no exception.
fn kind_label(v: i32) -> &'static str {
    match search_pb::SearchKind::try_from(v).unwrap_or(search_pb::SearchKind::Unspecified) {
        search_pb::SearchKind::Task => "task",
        search_pb::SearchKind::Page => "page",
        search_pb::SearchKind::Comment => "comment",
        search_pb::SearchKind::Project => "project",
        search_pb::SearchKind::User => "user",
        search_pb::SearchKind::Unspecified => "unspecified",
    }
}

/// Mirrors `search_service::MAX_LIMIT` (private to `transport`, so this is a
/// hardcoded copy, not a shared constant). `search_core` clamps to this
/// silently, with no signal to the caller — so this tool has to refuse a
/// larger `limit` itself (see [`limit_arg_capped`]) rather than merely
/// advertise the bound in `inputSchema`. `tools/call` never validates
/// arguments against that schema, so a client that ignores it — or a model
/// that miscounts — must still be stopped here.
const SEARCH_LIMIT_CAP: usize = 50;

pub const SEARCH: ToolMeta = ToolMeta {
    name: "search",
    description: "Search tasks, projects, pages, and comments by keyword. \
                  Use this when the user refers to something by name rather than id.",
    // `maximum: SEARCH_LIMIT_CAP` (50), not the 200 `list_projects`/`my_tasks`
    // use — those two schemas can honestly say 200 because their core fns
    // impose no cap of their own and use whatever limit they're given.
    // `search_core` is the odd one out: it hard-caps at 50 with no escape
    // hatch. This schema value is advisory only — `tools/call` doesn't
    // validate against it — so `search`'s handler enforces the same bound
    // itself via `limit_arg_capped`; this number and that one must be kept
    // in sync by hand, since `inputSchema` is JSON, not Rust.
    schema: || json!({
        "type": "object",
        "properties": {
            "query": { "type": "string" },
            "limit": { "type": "integer", "minimum": 1, "maximum": SEARCH_LIMIT_CAP }
        },
        "required": ["query"]
    }),
    handler: |ctx, args| Box::pin(search(ctx, args)),
};

pub async fn search(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    // `SearchRequest.q`, not `.query` — the tool argument name and the proto
    // field name differ. And `limit` is a real field on the request, not
    // something this tool trims client-side: `search_core` reinterprets `0`
    // as its own default of 20 and hard-caps whatever it's given at
    // `SEARCH_LIMIT_CAP`, so passing the parsed limit down is what makes
    // "give me up to N" actually reach the query instead of being silently
    // re-truncated after the fact. `limit_arg_capped` (not `limit_arg`)
    // refuses anything above that cap itself — see `SEARCH_LIMIT_CAP`'s doc
    // comment for why the schema's own `maximum` isn't enough on its own.
    //
    // `SearchRequest.kinds`/`.assignee_ids` would let a model narrow a search
    // to just tasks, or to one assignee's tasks. Left empty (unfiltered) as a
    // deliberate scope cut for a twelve-tool budget — a model that wants only
    // tasks currently has to filter `kind == "task"` out of the results
    // itself, the same way `list_modules` deliberately has no `limit`.
    let req = search_pb::SearchRequest {
        q: str_arg(args, "query")?,
        kinds: Vec::new(),
        assignee_ids: Vec::new(),
        limit: limit_arg_capped(args, SEARCH_LIMIT_CAP)? as u32,
    };
    let resp = search_core(&ctx.store, &ctx.auth, req).await?;
    let rows: Vec<Value> = resp
        .results
        .iter()
        .map(|r| json!({
            "kind": kind_label(r.kind),
            // `SearchResult.id`, not `.entity_id` — the task file's draft
            // guessed wrong.
            "id": r.id,
            "title": r.title,
            "snippet": truncate(&r.snippet),
            "project_id": r.project_id,
            "project_name": r.project_name,
            // A comment hit's own `title` is empty, so `task_id` — the
            // comment's parent task, resolved by `search_core` via a
            // dedicated lookup — is the only thing that makes a `kind:
            // "comment"` result actionable at all; dropping it would leave
            // the model with an id it can do nothing with. `parent_id`/
            // `parent_title` are the same idea for a subtask hit: they orient
            // which task the subtask belongs to, since the subtask's own
            // title can't convey that by itself. Both `None` for every other
            // kind, and that's fine — a flat schema beats a shape that
            // changes per `kind`.
            "task_id": r.task_id,
            "parent_id": r.parent_id,
            "parent_title": r.parent_title,
        }))
        .collect();
    let count = rows.len();
    Ok(json!({ "results": rows, "count": count }))
}

pub const MY_TASKS: ToolMeta = ToolMeta {
    name: "my_tasks",
    description: "Tasks this user is connected to, across every project. `scope` picks \
                  the connection: `assigned` (the default, and the answer to 'what \
                  should I work on'), `created` for tasks they opened, or `involving` \
                  for tasks they commented on or were mentioned in. `involving` is \
                  about discussion, not ownership — it does not include tasks merely \
                  assigned to them.",
    schema: || json!({
        "type": "object",
        "properties": {
            "scope": {
                "type": "string",
                "enum": ["assigned", "created", "involving"],
                "description": "assigned (default) | created | involving \
                                (commented on or mentioned in)"
            },
            "status": { "type": "string", "enum": ["todo", "in_progress", "done", "cancelled"] },
            "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
        }
    }),
    handler: |ctx, args| Box::pin(my_tasks(ctx, args)),
};

pub async fn my_tasks(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    // MyTasksService is three RPCs, not one, and they differ only in which
    // relationship to the user they filter on. Exposing three near-identical
    // tools would spend the model's attention on a distinction one enum
    // argument already makes; `assigned` is the default because it answers
    // the question people actually ask.
    //
    // `MyTasksRequest` paginates with `page`/`page_size`, not `limit` — and
    // `page_size == 0` is its own "use my default of 20" sentinel, the same
    // trap `ListProjectsRequest.limit` set. Passing the parsed limit down as
    // `page_size` (page fixed at 1) is what makes the tool's cap the one that
    // actually applies, instead of truncating a full page client-side.
    //
    // `status` is validated and sent as `MyTasksRequest.status`, not filtered
    // client-side after the fact: the core fn filters by status *before*
    // paginating (`respond()` in `mytasks_service.rs`), so filtering only
    // client-side here — after the server has already cut the result down to
    // one `page_size`-sized page — could silently drop matches that existed
    // past that page. A typo'd label is still refused up front, same as
    // `list_tasks`, rather than silently matching nothing.
    let status = match opt_str(args, "status") {
        Some(s) => match domain::task::TaskStatus::parse(&s) {
            Some(st) => Some(st.to_proto()),
            None => {
                return Err(ToolError::BadArgs(format!(
                    "`status` must be one of todo, in_progress, done, cancelled (got `{s}`)"
                )))
            }
        },
        None => None,
    };
    let req = dashboard_pb::MyTasksRequest {
        status,
        priority: None,
        page: 1,
        page_size: limit_arg(args)? as u32,
    };
    let resp = match opt_str(args, "scope").as_deref().unwrap_or("assigned") {
        "assigned" => list_assigned_to_me_core(&ctx.store, &ctx.auth, req).await?,
        "created" => list_created_by_me_core(&ctx.store, &ctx.auth, req).await?,
        "involving" => list_involving_me_core(&ctx.store, &ctx.auth, req).await?,
        other => {
            return Err(ToolError::BadArgs(format!(
                "unknown scope `{other}`: expected assigned, created, or involving"
            )))
        }
    };
    // `MyTasksResponse` is `{ items: [MyTask], total }`, and each `MyTask`
    // wraps a `Task` with the project and module names — context the model
    // would otherwise need a second call to `get_project` to recover. `task`
    // is `Option<Task>`; a row without one is skipped, not unwrapped.
    let rows: Vec<Value> = resp
        .items
        .iter()
        .filter_map(|m| m.task.as_ref().map(|t| (m, t)))
        .map(|(m, t)| {
            let mut row = super::tasks::flatten(t);
            row["project_id"] = json!(m.project_id);
            row["project_name"] = json!(m.project_name);
            row["module_name"] = json!(m.module_name);
            row
        })
        .collect();
    let count = rows.len();
    Ok(json!({ "tasks": rows, "count": count, "total": resp.total }))
}
