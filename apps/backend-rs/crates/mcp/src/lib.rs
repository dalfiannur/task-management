//! MCP endpoint: a single Streamable HTTP route that exposes the portal's
//! tools to a user's own AI client, authenticated with a personal access
//! token.
//!
//! Mounted at `/mcp` on the server; public at `/api/tasks-rs/mcp` (the proxy
//! strips the `/api/tasks-rs` prefix, same as for Connect routes).

mod pat;
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

use protocol::{
    error, initialize_result, result, Rpc, INVALID_REQUEST, METHOD_NOT_FOUND, PARSE_ERROR,
};

/// Bad or missing credentials answer at the HTTP layer, not as a JSON-RPC error:
/// a client needs to tell "my token is wrong" apart from "my request was wrong",
/// and only the former is worth re-prompting the user about.
fn unauthorized(id: Option<Value>) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        [("WWW-Authenticate", "Bearer realm=\"sedjiwa-tasks-mcp\"")],
        Json(error(id, -32001, "invalid or missing access token")),
    )
        .into_response()
}

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
    Extension(state): Extension<McpState>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    // Two stages, because these are two different client bugs: a body that is not
    // JSON at all, and a body that is JSON but not a JSON-RPC request. Collapsing
    // them into one code tells a client its transport is broken when its request
    // builder is what is actually wrong.
    let Ok(raw) = serde_json::from_slice::<Value>(&body) else {
        return Json(error(None, PARSE_ERROR, "request body is not valid JSON")).into_response();
    };
    let id = raw.get("id").cloned();
    let Ok(rpc) = serde_json::from_value::<Rpc>(raw) else {
        return Json(error(id, INVALID_REQUEST, "not a valid JSON-RPC request")).into_response();
    };

    // A notification (no `id`) is never answered — the spec calls for an empty 202.
    let is_notification = rpc.id.is_none();

    // `initialize`/`ping` are deliberately open: a client must be able to
    // finish the handshake and display the server's name before the user
    // pastes in a token.
    let needs_auth = !matches!(rpc.method.as_str(), "initialize" | "ping")
        && !rpc.method.starts_with("notifications/");
    let auth = if needs_auth {
        let header = headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok());
        match pat::authenticate(&state.store, header).await {
            Ok(u) => Some(u),
            Err(_) => return unauthorized(rpc.id),
        }
    } else {
        None
    };
    let _ = &auth; // used starting from Task 9

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
