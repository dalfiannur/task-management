//! Flatten user ECS components ↔ the `User` proto, plus store lookups.

use arke::{Entity, World};
use auth::AuthUser;
use domain::user::{
    AdminMark, UserPassword, UserPhone, UserProfile, UserStatus, UserStatusComponent,
};
use persistence::{PgTable, Store};

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

/// One page of users, optionally narrowed to a status, newest registration
/// first, plus the unpaged total for that same filter.
///
/// Paged in SQL, following `activity::record::activity_recent_page`. The reason
/// is the same: nothing bounds this set — an admin listing every account matches
/// the whole table — and hydrating every match to then keep twenty rows costs an
/// existence query plus one query per registered component for each row thrown
/// away. The subselect caps hydration at `page_size` rows whatever the table
/// size, and `total` comes from a COUNT that hydrates nothing.
///
/// Queried through `UserStatusComponent`, not `UserPhone` as the unpaged loader
/// does, so that the filter, the ordering, and the page all read from one table
/// — `status` is indexed there and `created_at` lives there too. Hydration still
/// materializes the entity's other components, so `read_user` is unaffected.
pub(crate) async fn load_users_page(
    store: &Store,
    status: Option<UserStatus>,
    page: u32,
    page_size: u32,
) -> anyhow::Result<(Vec<UserRecord>, u32)> {
    // `as_str` is a fixed enum rendering, never caller text, so it is safe in
    // the trusted predicate.
    let filter = status.map(|s| format!("status = '{}'", s.as_str()));
    let total = store
        .count::<UserStatusComponent>(filter.as_deref())
        .await?;

    let start = page.saturating_sub(1).saturating_mul(page_size);
    let where_c = filter
        .as_ref()
        .map(|f| format!("WHERE {f} "))
        .unwrap_or_default();
    // COLLATE "C" so Postgres orders these RFC3339 strings byte-wise, matching
    // how Rust compares them below; the default collation can order punctuation
    // differently and would hand back a different page than the caller's sort
    // implies. The outer query does not preserve this order, hence the re-sort.
    let pred = format!(
        "pid IN (SELECT pid FROM {table} {where_c}ORDER BY created_at COLLATE \"C\" DESC, pid DESC LIMIT {page_size} OFFSET {start})",
        table = <UserStatusComponent as PgTable>::TABLE,
    );
    let mut v = store
        .query::<UserStatusComponent, UserRecord>(Some(&pred), |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| read_user(world, *e, *pid))
                .collect()
        })
        .await?;
    v.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| b.pid.cmp(&a.pid))
    });
    Ok((v, total))
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

/// The `AuthUser` a Connect handler would see for this user — used by the PAT
/// path, which carries the owner's id but not their permissions.
///
/// Permissions are read fresh each time rather than frozen into the token:
/// that's what makes a token automatically lose its rights the moment the
/// user is suspended or has their admin status revoked.
pub async fn auth_user_for(store: &Store, user_id: &str) -> anyhow::Result<Option<AuthUser>> {
    let Ok(pid) = user_id.parse::<i64>() else {
        return Ok(None);
    };
    let Some(u) = load_user(store, pid).await? else {
        return Ok(None);
    };
    if u.status != UserStatus::Active {
        return Ok(None);
    }
    Ok(Some(AuthUser {
        id: user_id.to_string(),
        permissions: if u.is_admin { vec!["*".to_string()] } else { vec![] },
    }))
}
