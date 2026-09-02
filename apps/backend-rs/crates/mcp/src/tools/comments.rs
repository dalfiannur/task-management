//! Comment tools: `list_comments`, `add_comment`. `add_comment` forwards the
//! `Notifier` so a comment written by the AI triggers a mention notification
//! exactly like one typed by a human — see `create_comment_core`'s own doc
//! comment.

use serde_json::{json, Value};
use transport::api::{comment_pb, create_comment_core, list_comments_core};

use super::{limit_arg, opt_str_list, str_arg, truncate, Ctx, ToolError, ToolMeta};

/// Proto `Comment` → flat JSON, shared between `list_comments` and
/// `add_comment` so a freshly-posted comment and one read back later come
/// back in exactly the same shape. All seven `Comment` fields are surfaced —
/// `mentioned_user_ids`/`updated_at` included — rather than trimmed down to
/// the task file's four-field draft, per the standing note that a silently
/// dropped proto field is the one recurring review criticism here.
fn flatten(c: &comment_pb::Comment) -> Value {
    json!({
        "id": c.id,
        "task_id": c.task_id,
        "author_id": c.author_id,
        "content": truncate(&c.content),
        "mentioned_user_ids": c.mentioned_user_ids,
        "created_at": c.created_at,
        "updated_at": c.updated_at,
    })
}

pub const LIST_COMMENTS: ToolMeta = ToolMeta {
    name: "list_comments",
    description: "List the discussion on a task, oldest first.",
    schema: || {
        json!({
            "type": "object",
            "properties": {
                "task_id": { "type": "string" },
                "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
            },
            "required": ["task_id"]
        })
    },
    handler: |ctx, args| Box::pin(list_comments(ctx, args)),
};

pub async fn list_comments(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    // `ListCommentsRequest.page_size == 0` is `list_comments_core`'s own
    // "use my default of 50" sentinel — the same trap `ListProjectsRequest`/
    // `SearchRequest` set, and the reason `limit_arg` (not a default request
    // trimmed afterward) is sent straight through as `page_size`. Unlike
    // `search_core`, this core fn imposes no ceiling of its own on
    // `page_size`, so plain `limit_arg` (max 200) is the right helper —
    // `limit_arg_capped` is for a core fn with a lower cap of its own, and
    // this one has none.
    //
    // `page` is fixed at 1: this tool never exposes pagination past the
    // first `limit`-sized page, the same deliberate cut `my_tasks`/`search`
    // make for the same reason — a discussion thread's realistic size fits
    // in one call, and `total` (below) tells the model when it doesn't.
    let req = comment_pb::ListCommentsRequest {
        task_id: str_arg(args, "task_id")?,
        page: 1,
        page_size: limit_arg(args)? as u32,
    };
    let resp = list_comments_core(&ctx.store, &ctx.auth, req).await?;
    let rows: Vec<Value> = resp.comments.iter().map(flatten).collect();
    let count = rows.len();
    Ok(json!({ "comments": rows, "count": count, "total": resp.total }))
}

pub const ADD_COMMENT: ToolMeta = ToolMeta {
    name: "add_comment",
    description: "Post a comment on a task, on behalf of the token's owner. \
                  `mentioned_user_ids` notifies those users; any id that isn't \
                  a member of the task's project is silently dropped from that \
                  list rather than rejected.",
    schema: || {
        json!({
            "type": "object",
            "properties": {
                "task_id": { "type": "string" },
                "content": { "type": "string" },
                "mentioned_user_ids": { "type": "array", "items": { "type": "string" } }
            },
            "required": ["task_id", "content"]
        })
    },
    handler: |ctx, args| Box::pin(add_comment(ctx, args)),
};

pub async fn add_comment(ctx: &Ctx, args: &Value) -> Result<Value, ToolError> {
    let req = comment_pb::CreateCommentRequest {
        task_id: str_arg(args, "task_id")?,
        content: str_arg(args, "content")?,
        // Unlike `create_task`'s always-empty `label_ids`, this is a genuine
        // optional argument, not a scope cut: `search`'s `kind: "user"`
        // results (`search::indexer::user_doc`) are the only way a caller of
        // this MCP surface can turn a name into an id, and leaving this
        // field unreachable would strand that lookup with nothing to do.
        // `create_comment_core` filters it to actual project members anyway
        // (see the schema description), so a stale or guessed id is inert
        // rather than harmful.
        mentioned_user_ids: opt_str_list(args, "mentioned_user_ids")?.unwrap_or_default(),
    };
    // The notifier is forwarded, not omitted: mentions in a comment the AI
    // writes must notify the same people a human-typed one would, and
    // `create_comment_core` only does that when it's given a `Notifier`.
    let c = create_comment_core(&ctx.store, Some(&ctx.notifier), &ctx.auth, req).await?;
    Ok(flatten(&c))
}
