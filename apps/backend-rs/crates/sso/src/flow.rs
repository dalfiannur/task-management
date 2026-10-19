//! Which local account a portal sign-in becomes (decided by the user,
//! 2026-10-19):
//! 1. already linked → that account;
//! 2. else the portal's phone is verified and matches one account here → link
//!    it;
//! 3. else no account has that phone and the portal has verified it → create
//!    an Active, non-admin account and link it (2026-10-20: verified only, so
//!    nobody can take a number that is not theirs);
//! 4. else refuse: an unverified phone neither links nor creates (that would
//!    hand over, or take, a number on an unproven claim), and a phone that
//!    matches several accounts is ambiguous.
//!
//! Inactive accounts (pending, suspended, the automation identity) are
//! refused in every case.

use persistence::Store;
use transport::api::{auth_user_for, create_external_user, users_with_phone_digits_ending};

use crate::oidc::Identity;
use crate::{phone, record};

/// Why a sign-in failed. The key travels to the app page as `?error=`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// The portal account has no phone number.
    NoPhone,
    /// The number belongs to an account here, but the portal has not verified it.
    PhoneUnverified,
    /// Nobody here has the number, but the portal has not verified it, so no
    /// account is created for it.
    VerifyPhone,
    /// The number matches more than one account here.
    Ambiguous,
    /// That account is already linked to a different portal account.
    LinkedElsewhere,
    /// Pending, suspended, or not a person.
    Inactive,
}

impl Refusal {
    pub fn key(self) -> &'static str {
        match self {
            Refusal::NoPhone => "no_phone",
            Refusal::PhoneUnverified => "phone_unverified",
            Refusal::VerifyPhone => "verify_phone",
            Refusal::Ambiguous => "ambiguous",
            Refusal::LinkedElsewhere => "linked_elsewhere",
            Refusal::Inactive => "inactive",
        }
    }
}

pub enum Outcome {
    User(i64),
    Refused(Refusal),
}

fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

async fn active(store: &Store, pid: i64) -> anyhow::Result<Outcome> {
    Ok(match auth_user_for(store, &pid.to_string()).await? {
        Some(_) => Outcome::User(pid),
        None => Outcome::Refused(Refusal::Inactive),
    })
}

pub async fn resolve(store: &Store, issuer: &str, id: &Identity) -> anyhow::Result<Outcome> {
    if let Some(pid) = record::user_for(store, issuer, &id.sub).await? {
        return active(store, pid).await;
    }
    let canonical = phone::normalize(id.phone_number.as_deref().unwrap_or_default());
    if canonical.is_empty() {
        return Ok(Outcome::Refused(Refusal::NoPhone));
    }
    let verified = id.phone_number_verified.unwrap_or(false);
    // Compare on the portal's normal form: accounts here keep the phone as typed.
    let local = canonical.trim_start_matches('0');
    let matches: Vec<i64> = users_with_phone_digits_ending(store, local)
        .await?
        .into_iter()
        .filter(|(_, stored)| phone::normalize(stored) == canonical)
        .map(|(pid, _)| pid)
        .collect();
    let now = now_iso();
    let pid = match matches.as_slice() {
        [] if !verified => return Ok(Outcome::Refused(Refusal::VerifyPhone)),
        [] => {
            let name = id
                .name
                .as_deref()
                .map(str::trim)
                .filter(|n| !n.is_empty())
                .unwrap_or(&canonical)
                .to_string();
            let email = id.email.as_deref().unwrap_or_default().trim().to_string();
            create_external_user(store, &canonical, true, &name, &email, now.clone()).await?
        }
        [one] if verified => *one,
        [_] => return Ok(Outcome::Refused(Refusal::PhoneUnverified)),
        _ => return Ok(Outcome::Refused(Refusal::Ambiguous)),
    };
    if record::is_linked(store, pid).await? || !record::link(store, pid, issuer, &id.sub, &now).await? {
        // Linked to another portal account, or this one raced us to a link.
        return Ok(match record::user_for(store, issuer, &id.sub).await? {
            Some(p) if p == pid => active(store, pid).await?,
            _ => Outcome::Refused(Refusal::LinkedElsewhere),
        });
    }
    active(store, pid).await
}
