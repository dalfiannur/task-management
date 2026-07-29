//! Idempotent admin seed: create the first Active admin if it doesn't exist.
//!
//! Env: `DATABASE_URL` (required); `SEED_ADMIN_PHONE` / `SEED_ADMIN_PASSWORD` /
//! `SEED_ADMIN_NAME` (dev defaults). Re-running is a no-op once the phone exists.

use anyhow::{anyhow, Result};
use auth::hash_password;
use domain::user::{
    AdminMark, UserPassword, UserPhone, UserProfile, UserStatus, UserStatusComponent,
};
use persistence::Store;

fn now_iso() -> String {
    use time::format_description::well_known::Rfc3339;
    time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    let database_url = std::env::var("DATABASE_URL").map_err(|_| anyhow!("DATABASE_URL not set"))?;
    let phone = std::env::var("SEED_ADMIN_PHONE").unwrap_or_else(|_| "0800000000".into());
    let password = std::env::var("SEED_ADMIN_PASSWORD").unwrap_or_else(|_| "admin12345".into());
    let name = std::env::var("SEED_ADMIN_NAME").unwrap_or_else(|_| "Admin".into());

    let store = Store::connect(&database_url, domain::register_all).await?;

    // Idempotent: skip if a user with this phone already exists.
    let phone_q = phone.clone();
    let existing = store
        .query::<UserPhone, i64>(None, move |world, pairs| {
            pairs
                .iter()
                .filter(|(_, e)| {
                    world
                        .get::<UserPhone>(*e)
                        .map(|p| p.value == phone_q)
                        .unwrap_or(false)
                })
                .map(|(pid, _)| *pid)
                .collect()
        })
        .await?;
    if let Some(pid) = existing.first() {
        println!("seed_admin: admin already exists (pid {pid}, phone {phone}) — nothing to do");
        return Ok(());
    }

    let now = now_iso();
    let hash = hash_password(&password).map_err(|e| anyhow!(e.to_string()))?;
    let pid = store
        .create((
            UserPhone {
                value: phone.clone(),
                verified: true,
            },
            UserPassword {
                hash,
                changed_at: now.clone(),
            },
            UserProfile {
                display_name: name,
                avatar_url: String::new(),
                email: String::new(),
            },
            UserStatusComponent {
                status: UserStatus::Active.as_str().to_string(),
                created_at: now.clone(),
                last_login_at: None,
            },
        ))
        .await?;
    store
        .update(pid, move |w, e| {
            w.insert(e, AdminMark { granted_at: now });
        })
        .await?;

    println!("seed_admin: created admin pid {pid} phone {phone} (password from SEED_ADMIN_PASSWORD)");
    Ok(())
}
