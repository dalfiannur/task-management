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
use connectrpc_axum::{Code, ConnectError};
use persistence::Store;
use serde_json::{json, Value};
use std::future::Future;
use std::pin::Pin;
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
    /// The tool could not run at all. Rephrasing the call will not help, and
    /// the detail belongs in our logs rather than in a third-party AI client:
    /// these messages are raw database and IO errors.
    Internal(String),
}

impl From<ConnectError> for ToolError {
    fn from(e: ConnectError) -> Self {
        // `message()` is the sentence the handler wrote for a human; the code
        // is used only when the handler didn't include a message.
        let text = e.message().unwrap_or(e.code().as_str()).to_string();
        // Folding an infrastructure fault in with the business codes hands a
        // model a raw database error and invites it to "read the reason and
        // retry correctly" — which is not something it can do about a dropped
        // connection, and that text is not ours to give a third-party client.
        match e.code() {
            Code::Internal | Code::Unavailable | Code::Unknown | Code::DataLoss => {
                ToolError::Internal(text)
            }
            _ => ToolError::Business(text),
        }
    }
}

/// A tool's handler, boxed so `ToolMeta` can hold one in a `const`.
pub type Handler = for<'a> fn(
    &'a Ctx,
    &'a Value,
) -> Pin<Box<dyn Future<Output = Result<Value, ToolError>> + Send + 'a>>;

/// Everything the protocol needs both to advertise a tool and to run it.
///
/// The handler lives here rather than in a separate dispatch table on purpose.
/// Two hand-maintained lists keyed by tool name eventually disagree, and the
/// failure is silent in both directions: a tool advertised but not dispatchable
/// fails every call with "unknown tool", and one dispatchable but unlisted is
/// callable yet undiscoverable. With a single list neither is expressible.
pub struct ToolMeta {
    pub name: &'static str,
    pub description: &'static str,
    pub schema: fn() -> Value,
    pub handler: Handler,
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

/// Run one tool. `BadArgs` becomes a JSON-RPC error, `Business` an `isError`
/// tool result, and `Internal` is logged and answered generically.
pub async fn dispatch(ctx: &Ctx, name: &str, args: &Value) -> Result<Value, ToolError> {
    match TOOLS.iter().find(|t| t.name == name) {
        Some(tool) => (tool.handler)(ctx, args).await,
        None => Err(ToolError::BadArgs(format!("unknown tool: {name}"))),
    }
}

/// Tool result → MCP `content`. We send JSON inside a single text block:
/// every client renders `text`, while the JSON structure stays readable by
/// the model.
pub fn ok_content(value: Value) -> Value {
    json!({
        // Compact, not pretty: the caps above exist to protect the client's
        // context window, and indentation spends tokens on the largest
        // payloads for something no model needs in order to parse JSON.
        "content": [{ "type": "text", "text": serde_json::to_string(&value).unwrap_or_default() }],
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

/// Absent means "not supplied". A wrong-typed value is refused rather than read
/// as absent: id arrays are the argument a client is most likely to get wrong,
/// and silently dropping a bad element would assign a task to fewer people than
/// the model asked for and then report success.
pub fn opt_str_list(args: &Value, key: &str) -> Result<Option<Vec<String>>, ToolError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Array(items)) => items
            .iter()
            .map(|v| {
                v.as_str().map(str::to_string).ok_or_else(|| {
                    ToolError::BadArgs(format!("every element of `{key}` must be a string"))
                })
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Some),
        Some(_) => Err(ToolError::BadArgs(format!(
            "`{key}` must be an array of strings"
        ))),
    }
}

/// A capped `limit`: default 50, maximum 200. This bound is what keeps a
/// single tool call from swallowing the client's entire context.
pub const DEFAULT_LIMIT: usize = 50;
pub const MAX_LIMIT: usize = 200;

/// Absent means "use the default". Present-but-unusable is a caller bug and is
/// refused rather than silently clamped: quietly turning `limit: 0` into 1, or
/// `limit: -5` into 50, teaches the model nothing about why it did not get what
/// it asked for.
pub fn limit_arg(args: &Value) -> Result<usize, ToolError> {
    limit_arg_capped(args, MAX_LIMIT)
}

/// Like [`limit_arg`], but for a tool whose core fn imposes a lower ceiling of
/// its own. Advertising the bound in `inputSchema` is not enough: `tools/call`
/// does not validate arguments against the schema, so a client that ignores it
/// must still be refused here rather than silently truncated downstream.
pub fn limit_arg_capped(args: &Value, max: usize) -> Result<usize, ToolError> {
    match args.get("limit") {
        None | Some(Value::Null) => Ok(DEFAULT_LIMIT.min(max)),
        Some(v) => v
            .as_u64()
            .filter(|n| (1..=max as u64).contains(n))
            .map(|n| n as usize)
            .ok_or_else(|| {
                ToolError::BadArgs(format!(
                    "`limit` must be a whole number between 1 and {max}"
                ))
            }),
    }
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
