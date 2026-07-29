mod config;
mod interceptor;
mod router;

use std::sync::Arc;

use config::Config;
use persistence::Store;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cfg = Config::from_env()?;
    let store = Arc::new(Store::connect(&cfg.database_url, domain::register_all).await?);
    let media_storage: Arc<dyn storage::Storage> = Arc::new(storage::S3Storage::from_env()?);
    let app = router::build_router(&cfg, store, media_storage);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", cfg.port)).await?;
    tracing::info!(port = cfg.port, "backend-rs listening");
    axum::serve(listener, app).await?;
    Ok(())
}
