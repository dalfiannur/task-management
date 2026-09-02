//! Comment tools: `list_comments`, `add_comment`.
//!
//! Stubs only — Task 13 fills these in against `transport::api`'s comment
//! core fns.

use super::{Ctx, ToolError, ToolMeta};
use serde_json::{json, Value};

pub const LIST_COMMENTS: ToolMeta = ToolMeta {
    name: "list_comments",
    description: "List comments on a task.",
    schema: || json!({ "type": "object", "properties": {} }),
    handler: |ctx, args| Box::pin(list_comments(ctx, args)),
};

pub async fn list_comments(_ctx: &Ctx, _args: &Value) -> Result<Value, ToolError> {
    Err(ToolError::Business("not implemented yet".into()))
}

pub const ADD_COMMENT: ToolMeta = ToolMeta {
    name: "add_comment",
    description: "Add a comment to a task.",
    schema: || json!({ "type": "object", "properties": {} }),
    handler: |ctx, args| Box::pin(add_comment(ctx, args)),
};

pub async fn add_comment(_ctx: &Ctx, _args: &Value) -> Result<Value, ToolError> {
    Err(ToolError::Business("not implemented yet".into()))
}
