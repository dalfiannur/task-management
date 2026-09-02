//! JSON-RPC 2.0 envelope for MCP over Streamable HTTP.
//!
//! Stateless: there's no `Mcp-Session-Id`. Every request carries its own PAT,
//! so there's no session state to hold and any instance may serve any
//! request.

use serde::Deserialize;
use serde_json::{json, Value};

/// MCP spec versions we serve, newest first. If the client requests one of
/// these we answer with exactly that one; otherwise we answer with the first
/// and the client decides whether it still wants to proceed.
pub const SUPPORTED_VERSIONS: [&str; 2] = ["2025-06-18", "2025-03-26"];

pub const PARSE_ERROR: i64 = -32700;
/// Well-formed JSON that is not a JSON-RPC request. Distinct from PARSE_ERROR on
/// purpose: it tells a client its request builder is wrong, not its transport.
pub const INVALID_REQUEST: i64 = -32600;
pub const METHOD_NOT_FOUND: i64 = -32601;
pub const INVALID_PARAMS: i64 = -32602;

#[derive(Debug, Deserialize)]
pub struct Rpc {
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

pub fn result(id: Option<Value>, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

pub fn error(id: Option<Value>, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// The `initialize` reply. We only advertise `tools` — v1 has no `resources`,
/// `prompts`, or server-initiated messages.
pub fn initialize_result(params: &Value) -> Value {
    let requested = params
        .get("protocolVersion")
        .and_then(Value::as_str)
        .unwrap_or("");
    let version = SUPPORTED_VERSIONS
        .iter()
        .find(|v| **v == requested)
        .copied()
        .unwrap_or(SUPPORTED_VERSIONS[0]);
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": { "name": "sedjiwa-tasks", "version": env!("CARGO_PKG_VERSION") }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn echoes_a_supported_version() {
        let p = json!({ "protocolVersion": "2025-03-26" });
        assert_eq!(initialize_result(&p)["protocolVersion"], "2025-03-26");
    }

    #[test]
    fn falls_back_to_latest_for_unknown_version() {
        let p = json!({ "protocolVersion": "1999-01-01" });
        assert_eq!(initialize_result(&p)["protocolVersion"], SUPPORTED_VERSIONS[0]);
    }
}
