//! MCP endpoint: a single Streamable HTTP route that exposes the portal's
//! tools to a user's own AI client, authenticated with a personal access
//! token.
//!
//! Mounted at `/mcp` on the server; public at `/api/tasks-rs/mcp` (the proxy
//! strips the `/api/tasks-rs` prefix, same as for Connect routes).

mod protocol;

use std::sync::Arc;

use axum::extract::Extension;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::Json;
use persistence::Store;
use serde_json::Value;
use transport::Notifier;

use protocol::{error, initialize_result, result, Rpc, METHOD_NOT_FOUND, PARSE_ERROR};

#[derive(Clone)]
pub struct McpState {
    pub store: Arc<Store>,
    pub notifier: Arc<Notifier>,
}

/// MCP endpoint router. Mount with `Router::new().nest("/mcp", mcp_router(..))`.
pub fn mcp_router(store: Arc<Store>, notifier: Arc<Notifier>) -> axum::Router<()> {
    axum::Router::new()
        .route("/", post(handle_post).get(handle_get))
        .layer(Extension(McpState { store, notifier }))
}

/// GET is used by the spec to open a server→client SSE stream. v1 has no
/// server-initiated messages, so refusing it is more honest than opening a
/// stream that will never send anything.
async fn handle_get() -> Response {
    StatusCode::METHOD_NOT_ALLOWED.into_response()
}

async fn handle_post(
    Extension(_state): Extension<McpState>,
    body: axum::body::Bytes,
) -> Response {
    let Ok(rpc) = serde_json::from_slice::<Rpc>(&body) else {
        return Json(error(None, PARSE_ERROR, "invalid JSON-RPC request")).into_response();
    };

    // A notification (no `id`) is never answered — the spec calls for an empty 202.
    let is_notification = rpc.id.is_none();

    let response: Value = match rpc.method.as_str() {
        "initialize" => result(rpc.id.clone(), initialize_result(&rpc.params)),
        "ping" => result(rpc.id.clone(), serde_json::json!({})),
        m if m.starts_with("notifications/") => {
            return StatusCode::ACCEPTED.into_response();
        }
        other => error(rpc.id.clone(), METHOD_NOT_FOUND, &format!("unknown method: {other}")),
    };

    if is_notification {
        return StatusCode::ACCEPTED.into_response();
    }
    Json(response).into_response()
}
