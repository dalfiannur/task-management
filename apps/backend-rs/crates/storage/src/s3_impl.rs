//! `rust-s3`-backed [`Storage`] for S3-compatible endpoints (RustFS/MinIO/S3).

use anyhow::Result;
use async_trait::async_trait;
use s3::creds::Credentials;
use s3::{Bucket, Region};

use crate::Storage;

/// S3 connection config (from env with dev defaults).
#[derive(Debug, Clone)]
pub struct S3Config {
    /// Where THIS PROCESS reaches storage. Inside a container that is usually a
    /// service name on the compose network.
    pub endpoint: String,
    /// Where the BROWSER reaches storage, used only to sign presigned URLs.
    ///
    /// The two differ whenever storage sits behind a reverse proxy: the signed
    /// URL is opened by the browser, so it must name a host the browser can
    /// resolve over a scheme its page is allowed to use, while `head` and
    /// `delete` run from inside the network where that host may not resolve at
    /// all. Defaults to `endpoint`, so a deployment where one origin serves
    /// both — a plain host:port — needs to set nothing.
    pub public_endpoint: String,
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
            public_endpoint: std::env::var("S3_PUBLIC_ENDPOINT")
                .ok()
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| get("S3_ENDPOINT", "http://localhost:9000")),
            bucket: get("S3_BUCKET", "tasks-media"),
            access_key: get("S3_ACCESS_KEY", "minioadmin"),
            secret_key: get("S3_SECRET_KEY", "minioadmin"),
            region: get("S3_REGION", "us-east-1"),
            path_style: get("S3_FORCE_PATH_STYLE", "true") != "false",
        }
    }
}

pub struct S3Storage {
    /// Used for every call this process makes.
    bucket: Box<Bucket>,
    /// Used only to sign URLs handed to the browser. Same bucket and
    /// credentials, different endpoint; signing is offline, so this one is
    /// never connected to.
    public_bucket: Box<Bucket>,
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
        let mut bucket = Bucket::new(&cfg.bucket, region, creds.clone())?;
        if cfg.path_style {
            bucket.set_path_style();
        }
        let public_region = Region::Custom {
            region: cfg.region.clone(),
            endpoint: cfg.public_endpoint.clone(),
        };
        let mut public_bucket = Bucket::new(&cfg.bucket, public_region, creds)?;
        if cfg.path_style {
            public_bucket.set_path_style();
        }
        Ok(Self {
            bucket,
            public_bucket,
        })
    }

    pub fn from_env() -> Result<Self> {
        Self::new(S3Config::from_env())
    }
}

#[async_trait]
impl Storage for S3Storage {
    async fn presign_put(&self, key: &str, _mime: &str, ttl_secs: u32) -> Result<String> {
        Ok(self
            .public_bucket
            .presign_put(key, ttl_secs, None, None)
            .await?)
    }

    async fn presign_get(&self, key: &str, ttl_secs: u32) -> Result<String> {
        Ok(self.public_bucket.presign_get(key, ttl_secs, None).await?)
    }

    async fn head(&self, key: &str) -> Result<Option<u64>> {
        // `Ok(None)` means "storage answered, no such object". A transport
        // failure is NOT that, and must not be flattened into it: callers turn
        // `None` into "upload not found in storage", which sends whoever reads
        // it looking for a missing file when the truth is that storage was
        // never reached. That exact confusion cost a debugging session once.
        match self.bucket.head_object(key).await {
            Ok((head, 200)) => Ok(Some(head.content_length.unwrap_or(0).max(0) as u64)),
            Ok((_, 404)) => Ok(None),
            Ok((_, status)) => Err(anyhow::anyhow!(
                "storage HEAD {key} returned unexpected status {status}"
            )),
            Err(e) => Err(anyhow::anyhow!("storage HEAD {key} failed: {e}")),
        }
    }

    async fn delete(&self, key: &str) -> Result<()> {
        let _ = self.bucket.delete_object(key).await;
        Ok(())
    }
}
