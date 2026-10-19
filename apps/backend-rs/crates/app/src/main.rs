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
    let store = Arc::new(Store::connect(&cfg.database_url).await?);
    let media_storage: Arc<dyn storage::Storage> = Arc::new(storage::S3Storage::from_env()?);
    let notifier = Arc::new(transport::Notifier::new());
    spawn_automation_job(store.clone(), notifier.clone());
    // Optional: single sign-on through the Sedjiwa Portal, on when SSO_* is set.
    let sso = sso::SsoExt(sso::Sso::from_env());
    tracing::info!(enabled = sso.0.is_some(), "single sign-on");
    let app = router::build_router(&cfg, store, media_storage, notifier, sso);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", cfg.port)).await?;
    tracing::info!(port = cfg.port, "backend-rs listening");
    axum::serve(listener, app).await?;
    Ok(())
}

/// Every 15 minutes, run the time-based automations (overdue, due within N
/// days). Each (rule, task, due date) is claimed in the database, so several
/// instances running this at once still run each rule once.
fn spawn_automation_job(store: Arc<Store>, notifier: Arc<transport::Notifier>) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(15 * 60));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            // The workspace's day, not UTC's: "overdue" flips at local midnight.
            let today = match transport::workspace_today(&store).await {
                Ok(d) => d,
                Err(e) => {
                    tracing::warn!(error = %e, "workspace clock unavailable, using UTC");
                    time::OffsetDateTime::now_utc().date()
                }
            };
            match transport::run_scheduled_automations(&store, Some(&notifier), today).await {
                Ok(0) => {}
                Ok(n) => tracing::info!(runs = n, "time-based automations ran"),
                Err(e) => tracing::warn!(error = %e, "time-based automations failed"),
            }
        }
    });
}
