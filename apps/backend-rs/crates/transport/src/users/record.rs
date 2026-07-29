//! Flatten user ECS components ↔ the `User` proto, plus store lookups.

use arke::{Entity, World};
use domain::user::{
    AdminMark, UserPassword, UserPhone, UserProfile, UserStatus, UserStatusComponent,
};
use persistence::Store;

use crate::sedjiwa::tasks::auth::v1 as pb;

/// A fully-assembled user (all components flattened). `password_hash` never leaves
/// the backend — [`to_proto`] omits it.
#[derive(Debug, Clone)]
pub(crate) struct UserRecord {
    pub pid: i64,
    pub phone: String,
    pub display_name: String,
    pub avatar_url: String,
    pub email: String,
    pub status: UserStatus,
    pub created_at: String,
    pub last_login_at: Option<String>,
    pub is_admin: bool,
    pub password_hash: String,
}

/// Read a user entity's components into a [`UserRecord`]; `None` if a core
/// component is missing (not actually a user).
pub(crate) fn read_user(world: &World, e: Entity, pid: i64) -> Option<UserRecord> {
    let phone = world.get::<UserPhone>(e)?;
    let pass = world.get::<UserPassword>(e)?;
    let prof = world.get::<UserProfile>(e)?;
    let st = world.get::<UserStatusComponent>(e)?;
    Some(UserRecord {
        pid,
        phone: phone.value.clone(),
        display_name: prof.display_name.clone(),
        avatar_url: prof.avatar_url.clone(),
        email: prof.email.clone(),
        status: UserStatus::parse(&st.status)?,
        created_at: st.created_at.clone(),
        last_login_at: st.last_login_at.clone(),
        is_admin: world.get::<AdminMark>(e).is_some(),
        password_hash: pass.hash.clone(),
    })
}

/// Public `User` message (no hash).
pub(crate) fn to_proto(u: &UserRecord) -> pb::User {
    pb::User {
        id: u.pid.to_string(),
        phone: u.phone.clone(),
        display_name: u.display_name.clone(),
        email: u.email.clone(),
        avatar_url: u.avatar_url.clone(),
        status: u.status.to_proto(),
        is_admin: u.is_admin,
        created_at: u.created_at.clone(),
        last_login_at: u.last_login_at.clone(),
    }
}

/// All users (loads every `UserPhone` entity + its components; filter in Rust).
/// O(n) — user table is small; an indexed lookup is a later optimization.
pub(crate) async fn load_all_users(store: &Store) -> anyhow::Result<Vec<UserRecord>> {
    store
        .query::<UserPhone, UserRecord>(None, |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| read_user(world, *e, *pid))
                .collect()
        })
        .await
}

/// One user by `pid`. `pid` is a validated integer (safe to inline into the
/// trusted predicate — never user text).
pub(crate) async fn load_user(store: &Store, pid: i64) -> anyhow::Result<Option<UserRecord>> {
    let pred = format!("pid = {pid}");
    let mut v = store
        .query::<UserPhone, UserRecord>(Some(&pred), |world, pairs| {
            pairs
                .iter()
                .filter_map(|(p, e)| read_user(world, *e, *p))
                .collect()
        })
        .await?;
    Ok(v.pop())
}

/// Find a user by exact phone (login / uniqueness check).
pub(crate) async fn find_by_phone(store: &Store, phone: &str) -> anyhow::Result<Option<UserRecord>> {
    Ok(load_all_users(store)
        .await?
        .into_iter()
        .find(|u| u.phone == phone))
}
