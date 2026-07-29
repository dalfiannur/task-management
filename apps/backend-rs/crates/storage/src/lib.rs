//! Object storage (S3/RustFS) behind a trait so transport handlers can be tested
//! with a fake, and the concrete `rust-s3` impl lives only here.

use anyhow::Result;
use async_trait::async_trait;

/// Object storage: presigned URLs (offline signing) + head/delete (network).
#[async_trait]
pub trait Storage: Send + Sync {
    /// Presigned PUT URL for `key` (direct browser upload), valid `ttl_secs`.
    async fn presign_put(&self, key: &str, mime: &str, ttl_secs: u32) -> Result<String>;
    /// Presigned GET URL for `key` (download), valid `ttl_secs`.
    async fn presign_get(&self, key: &str, ttl_secs: u32) -> Result<String>;
    /// Object byte size if it exists, else `None`.
    async fn head(&self, key: &str) -> Result<Option<u64>>;
    /// Delete the object (best-effort; treat missing as success).
    async fn delete(&self, key: &str) -> Result<()>;
}

/// Unique storage key `{project_id}/{uuid}/{file_name}`.
pub fn new_storage_key(project_id: &str, file_name: &str) -> String {
    format!("{project_id}/{}/{file_name}", uuid::Uuid::new_v4())
}

mod s3_impl;
pub use s3_impl::{S3Config, S3Storage};
