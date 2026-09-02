//! Project tools: `list_projects`, `get_project`, `list_modules`.
//!
//! Stubs only — Task 11 fills these in against `transport::api`'s project
//! and module core fns.

use super::{Ctx, ToolError, ToolMeta};
use serde_json::{json, Value};

pub const LIST_PROJECTS: ToolMeta = ToolMeta {
    name: "list_projects",
    description: "List projects the caller is a member of.",
    schema: || json!({ "type": "object", "properties": {} }),
};

pub async fn list_projects(_ctx: &Ctx, _args: &Value) -> Result<Value, ToolError> {
    Err(ToolError::Business("not implemented yet".into()))
}

pub const GET_PROJECT: ToolMeta = ToolMeta {
    name: "get_project",
    description: "Get a single project by id.",
    schema: || json!({ "type": "object", "properties": {} }),
};

pub async fn get_project(_ctx: &Ctx, _args: &Value) -> Result<Value, ToolError> {
    Err(ToolError::Business("not implemented yet".into()))
}

pub const LIST_MODULES: ToolMeta = ToolMeta {
    name: "list_modules",
    description: "List modules within a project.",
    schema: || json!({ "type": "object", "properties": {} }),
};

pub async fn list_modules(_ctx: &Ctx, _args: &Value) -> Result<Value, ToolError> {
    Err(ToolError::Business("not implemented yet".into()))
}
