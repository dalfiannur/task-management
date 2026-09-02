//! Access tokens (PAT) for the MCP endpoint. See
//! docs/superpowers/specs/2026-09-02-mcp-server-design.md.

pub(crate) mod record;
mod token_service;

pub use token_service::token_router;
