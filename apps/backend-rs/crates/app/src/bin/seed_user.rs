//! Idempotent dev-fixture seed: create a regular (non-admin) Active user.
//!
//! Companion to `seed_admin` — useful when a flow needs a second identity
//! (mention notifications, member permissions, ownership transfer).
//!
//! Env: `DATABASE_URL` (required); `SEED_USER_PHONE` / `SEED_USER_PASSWORD` /
//! `SEED_USER_NAME` (dev defaults). Re-running is a no-op once the phone exists.

use anyhow::{anyhow, Result};
use auth::hash_password;
use domain::user::{UserPassword, UserPhone, UserProfile, UserStatus, UserStatusComponent};
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
    let phone = std::env::var("SEED_USER_PHONE").unwrap_or_else(|_| "0800000001".into());
    let password = std::env::var("SEED_USER_PASSWORD").unwrap_or_else(|_| "user12345".into());
    let name = std::env::var("SEED_USER_NAME").unwrap_or_else(|_| "Test User".into());

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
        println!("seed_user: user already exists (pid {pid}, phone {phone}) — nothing to do");
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
                created_at: now,
                last_login_at: None,
            },
        ))
        .await?;

    println!("seed_user: created user pid {pid} phone {phone} (password from SEED_USER_PASSWORD)");
    Ok(())
}
