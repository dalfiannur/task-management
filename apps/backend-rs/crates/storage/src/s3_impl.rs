//! `rust-s3`-backed [`Storage`] for S3-compatible endpoints (RustFS/MinIO/S3).

use anyhow::Result;
use async_trait::async_trait;
use s3::creds::Credentials;
use s3::{Bucket, Region};

use crate::Storage;

/// S3 connection config (from env with dev defaults).
#[derive(Debug, Clone)]
pub struct S3Config {
    pub endpoint: String,
    pub bucket: String,
    pub access_key: String,
    pub secret_key: String,
    pub region: String,
    pub path_style: bool,
}

impl S3Config {
    pub fn from_env() -> Self {
        let get = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.to_string());
        S3Config {
            endpoint: get("S3_ENDPOINT", "http://localhost:9000"),
            bucket: get("S3_BUCKET", "tasks-media"),
            access_key: get("S3_ACCESS_KEY", "minioadmin"),
            secret_key: get("S3_SECRET_KEY", "minioadmin"),
            region: get("S3_REGION", "us-east-1"),
            path_style: get("S3_FORCE_PATH_STYLE", "true") != "false",
        }
    }
}

pub struct S3Storage {
    bucket: Box<Bucket>,
}

impl S3Storage {
    pub fn new(cfg: S3Config) -> Result<Self> {
        let region = Region::Custom {
            region: cfg.region.clone(),
            endpoint: cfg.endpoint.clone(),
        };
        let creds = Credentials::new(
            Some(&cfg.access_key),
            Some(&cfg.secret_key),
            None,
            None,
            None,
        )?;
        let mut bucket = Bucket::new(&cfg.bucket, region, creds)?;
        if cfg.path_style {
            bucket.set_path_style();
        }
        Ok(Self { bucket })
    }

    pub fn from_env() -> Result<Self> {
        Self::new(S3Config::from_env())
    }
}

#[async_trait]
impl Storage for S3Storage {
    async fn presign_put(&self, key: &str, _mime: &str, ttl_secs: u32) -> Result<String> {
        Ok(self.bucket.presign_put(key, ttl_secs, None, None).await?)
    }

    async fn presign_get(&self, key: &str, ttl_secs: u32) -> Result<String> {
        Ok(self.bucket.presign_get(key, ttl_secs, None).await?)
    }

    async fn head(&self, key: &str) -> Result<Option<u64>> {
        match self.bucket.head_object(key).await {
            Ok((head, 200)) => Ok(Some(head.content_length.unwrap_or(0).max(0) as u64)),
            Ok(_) => Ok(None),
            Err(_) => Ok(None),
        }
    }

    async fn delete(&self, key: &str) -> Result<()> {
        let _ = self.bucket.delete_object(key).await;
        Ok(())
    }
}
