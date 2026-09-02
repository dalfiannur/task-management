//! MCP tool registry: metadata for `tools/list` and dispatch for
//! `tools/call`.
//!
//! Every tool calls the same core fn as the Connect handler (`transport::api`),
//! so member-gating, validation, activity recording, notifications, and search
//! indexing all come along without duplicated rules.

pub mod comments;
pub mod discovery;
pub mod projects;
pub mod tasks;

use std::sync::Arc;

use auth::AuthUser;
use connectrpc_axum::ConnectError;
use persistence::Store;
use serde_json::{json, Value};
use transport::Notifier;

/// What a tool needs in order to run.
pub struct Ctx {
    pub store: Arc<Store>,
    pub notifier: Arc<Notifier>,
    pub auth: AuthUser,
}

pub enum ToolError {
    /// The request is well-formed but rejected by a business rule → tool
    /// result `isError`, since the model can read the reason and retry
    /// correctly.
    Business(String),
    /// The arguments themselves are malformed → a JSON-RPC protocol error.
    BadArgs(String),
}

impl From<ConnectError> for ToolError {
    fn from(e: ConnectError) -> Self {
        // `message()` is the sentence the handler wrote for a human; the code
        // is used only when the handler didn't include a message.
        ToolError::Business(e.message().unwrap_or(e.code().as_str()).to_string())
    }
}

pub struct ToolMeta {
    pub name: &'static str,
    pub description: &'static str,
    pub schema: fn() -> Value,
}

pub const TOOLS: &[ToolMeta] = &[
    tasks::LIST_TASKS,
    tasks::GET_TASK,
    tasks::CREATE_TASK,
    tasks::UPDATE_TASK,
    tasks::MOVE_TASK,
    projects::LIST_PROJECTS,
    projects::GET_PROJECT,
    projects::LIST_MODULES,
    discovery::SEARCH,
    discovery::MY_TASKS,
    comments::LIST_COMMENTS,
    comments::ADD_COMMENT,
];

pub fn tool_list() -> Value {
    json!({
        "tools": TOOLS
            .iter()
            .map(|t| json!({
                "name": t.name,
                "description": t.description,
                "inputSchema": (t.schema)(),
            }))
            .collect::<Vec<_>>()
    })
}

/// Run a single tool. `Err(BadArgs)` means a protocol error; `Err(Business)`
/// is wrapped by the caller into an `isError` tool result.
pub async fn dispatch(ctx: &Ctx, name: &str, args: &Value) -> Result<Value, ToolError> {
    match name {
        "list_tasks" => tasks::list_tasks(ctx, args).await,
        "get_task" => tasks::get_task(ctx, args).await,
        "create_task" => tasks::create_task(ctx, args).await,
        "update_task" => tasks::update_task(ctx, args).await,
        "move_task" => tasks::move_task(ctx, args).await,
        "list_projects" => projects::list_projects(ctx, args).await,
        "get_project" => projects::get_project(ctx, args).await,
        "list_modules" => projects::list_modules(ctx, args).await,
        "search" => discovery::search(ctx, args).await,
        "my_tasks" => discovery::my_tasks(ctx, args).await,
        "list_comments" => comments::list_comments(ctx, args).await,
        "add_comment" => comments::add_comment(ctx, args).await,
        other => Err(ToolError::BadArgs(format!("unknown tool: {other}"))),
    }
}

/// Tool result → MCP `content`. We send JSON inside a single text block:
/// every client renders `text`, while the JSON structure stays readable by
/// the model.
pub fn ok_content(value: Value) -> Value {
    json!({
        "content": [{ "type": "text", "text": serde_json::to_string_pretty(&value).unwrap_or_default() }],
        "isError": false
    })
}

pub fn error_content(message: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": message }], "isError": true })
}

// --- Argument helpers, used across every tool module ---

pub fn str_arg(args: &Value, key: &str) -> Result<String, ToolError> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| ToolError::BadArgs(format!("`{key}` is required and must be a string")))
}

pub fn opt_str(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

pub fn opt_str_list(args: &Value, key: &str) -> Option<Vec<String>> {
    args.get(key).and_then(Value::as_array).map(|a| {
        a.iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect()
    })
}

/// A capped `limit`: default 50, maximum 200. This bound is what keeps a
/// single tool call from swallowing the client's entire context.
pub const DEFAULT_LIMIT: usize = 50;
pub const MAX_LIMIT: usize = 200;

pub fn limit_arg(args: &Value) -> usize {
    args.get("limit")
        .and_then(Value::as_u64)
        .map(|n| (n as usize).clamp(1, MAX_LIMIT))
        .unwrap_or(DEFAULT_LIMIT)
}

/// Long descriptions are truncated before being sent to the model.
pub const MAX_DESCRIPTION: usize = 2000;

pub fn truncate(s: &str) -> String {
    if s.chars().count() <= MAX_DESCRIPTION {
        return s.to_string();
    }
    let head: String = s.chars().take(MAX_DESCRIPTION).collect();
    format!("{head}… [truncated; open the task in the portal for the full text]")
}
