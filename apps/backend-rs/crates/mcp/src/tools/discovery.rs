//! Discovery tools: `search`, `my_tasks`.
//!
//! Stubs only — Task 12 fills these in against `transport::api`'s search and
//! "my tasks" core fns.

use super::{Ctx, ToolError, ToolMeta};
use serde_json::{json, Value};

pub const SEARCH: ToolMeta = ToolMeta {
    name: "search",
    description: "Search tasks, projects, and comments by text.",
    schema: || json!({ "type": "object", "properties": {} }),
    handler: |ctx, args| Box::pin(search(ctx, args)),
};

pub async fn search(_ctx: &Ctx, _args: &Value) -> Result<Value, ToolError> {
    Err(ToolError::Business("not implemented yet".into()))
}

pub const MY_TASKS: ToolMeta = ToolMeta {
    name: "my_tasks",
    description: "List tasks assigned to, created by, or involving the caller.",
    schema: || json!({ "type": "object", "properties": {} }),
    handler: |ctx, args| Box::pin(my_tasks(ctx, args)),
};

pub async fn my_tasks(_ctx: &Ctx, _args: &Value) -> Result<Value, ToolError> {
    Err(ToolError::Business("not implemented yet".into()))
}
