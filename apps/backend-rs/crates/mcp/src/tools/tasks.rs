//! Task tools: `list_tasks`, `get_task`, `create_task`, `update_task`,
//! `move_task`.
//!
//! Stubs only — Task 10 fills these in against `transport::api`'s task core
//! fns. `delete_task` is deliberately not among them; see `tools/mod.rs`.

use super::{Ctx, ToolError, ToolMeta};
use serde_json::{json, Value};

pub const LIST_TASKS: ToolMeta = ToolMeta {
    name: "list_tasks",
    description: "List tasks in a project or module.",
    schema: || json!({ "type": "object", "properties": {} }),
};

pub async fn list_tasks(_ctx: &Ctx, _args: &Value) -> Result<Value, ToolError> {
    Err(ToolError::Business("not implemented yet".into()))
}

pub const GET_TASK: ToolMeta = ToolMeta {
    name: "get_task",
    description: "Get a single task by id.",
    schema: || json!({ "type": "object", "properties": {} }),
};

pub async fn get_task(_ctx: &Ctx, _args: &Value) -> Result<Value, ToolError> {
    Err(ToolError::Business("not implemented yet".into()))
}

pub const CREATE_TASK: ToolMeta = ToolMeta {
    name: "create_task",
    description: "Create a new task.",
    schema: || json!({ "type": "object", "properties": {} }),
};

pub async fn create_task(_ctx: &Ctx, _args: &Value) -> Result<Value, ToolError> {
    Err(ToolError::Business("not implemented yet".into()))
}

pub const UPDATE_TASK: ToolMeta = ToolMeta {
    name: "update_task",
    description: "Update fields on an existing task.",
    schema: || json!({ "type": "object", "properties": {} }),
};

pub async fn update_task(_ctx: &Ctx, _args: &Value) -> Result<Value, ToolError> {
    Err(ToolError::Business("not implemented yet".into()))
}

pub const MOVE_TASK: ToolMeta = ToolMeta {
    name: "move_task",
    description: "Move a task to a different status or module.",
    schema: || json!({ "type": "object", "properties": {} }),
};

pub async fn move_task(_ctx: &Ctx, _args: &Value) -> Result<Value, ToolError> {
    Err(ToolError::Business("not implemented yet".into()))
}
