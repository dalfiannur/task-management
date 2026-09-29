//! User rows ↔ the `User` proto, plus every read and write the users flows make.
//!
//! Plain sqlx over the component tables arke-postgres created (see
//! `persistence::entity` for the invariants shared with arke while both run).
//! A user is one entity carrying `cmp_userphone`, `cmp_userpassword`,
//! `cmp_userprofile` and `cmp_userstatuscomponent`, and `cmp_adminmark` when it
//! is an admin. Every value is bound, never formatted into the statement.

use auth::AuthUser;
use domain::user::UserStatus;
use persistence::{entity, Store};
use sqlx::postgres::PgRow;
use sqlx::Row;

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

/// The four required components joined, admin as an outer join. The inner
/// joins are what "is a user" means: an entity missing any of them is not one,
/// exactly as arke's `read_user` returned `None` for it.
const SELECT_USER: &str = "\
    SELECT ph.pid, ph.value AS phone, pw.hash, pr.display_name, pr.avatar_url, pr.email, \
           st.status, st.created_at, st.last_login_at, (am.pid IS NOT NULL) AS is_admin \
    FROM cmp_userphone ph \
    JOIN cmp_userpassword pw ON pw.pid = ph.pid \
    JOIN cmp_userprofile pr ON pr.pid = ph.pid \
    JOIN cmp_userstatuscomponent st ON st.pid = ph.pid \
    LEFT JOIN cmp_adminmark am ON am.pid = ph.pid";

/// `None` for a stored status this build does not know, which drops the row
/// the same way the arke reader did.
fn read_user(row: &PgRow) -> sqlx::Result<Option<UserRecord>> {
    let status: String = row.try_get("status")?;
    let Some(status) = UserStatus::parse(&status) else {
        return Ok(None);
    };
    Ok(Some(UserRecord {
        pid: row.try_get("pid")?,
        phone: row.try_get("phone")?,
        display_name: row.try_get("display_name")?,
        avatar_url: row.try_get("avatar_url")?,
        email: row.try_get("email")?,
        status,
        created_at: row.try_get("created_at")?,
        last_login_at: row.try_get("last_login_at")?,
        is_admin: row.try_get("is_admin")?,
        password_hash: row.try_get("hash")?,
    }))
}

fn read_all(rows: &[PgRow]) -> sqlx::Result<Vec<UserRecord>> {
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.extend(read_user(row)?);
    }
    Ok(out)
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

// ── Reads ────────────────────────────────────────────────────────────────────

/// Every user, oldest account first.
pub(crate) async fn load_all_users(store: &Store) -> anyhow::Result<Vec<UserRecord>> {
    let rows = sqlx::query(&format!("{SELECT_USER} ORDER BY ph.pid"))
        .fetch_all(store.pool())
        .await?;
    Ok(read_all(&rows)?)
}

/// One page of users, optionally narrowed to a status, newest registration
/// first, plus the unpaged total for that same filter.
///
/// The total counts over the same join as the page, so it can never promise
/// rows the page will not produce.
pub(crate) async fn load_users_page(
    store: &Store,
    status: Option<UserStatus>,
    page: u32,
    page_size: u32,
) -> anyhow::Result<(Vec<UserRecord>, u32)> {
    let status = status.map(|s| s.as_str());
    let offset = i64::from(page.saturating_sub(1)) * i64::from(page_size);

    let total: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM cmp_userphone ph \
         JOIN cmp_userpassword pw ON pw.pid = ph.pid \
         JOIN cmp_userprofile pr ON pr.pid = ph.pid \
         JOIN cmp_userstatuscomponent st ON st.pid = ph.pid \
         WHERE $1::text IS NULL OR st.status = $1",
    )
    .bind(status)
    .fetch_one(store.pool())
    .await?;

    // COLLATE "C" orders these RFC3339 strings byte-wise; the default collation
    // can order punctuation differently and hand back a different page.
    let rows = sqlx::query(&format!(
        "{SELECT_USER} WHERE $1::text IS NULL OR st.status = $1 \
         ORDER BY st.created_at COLLATE \"C\" DESC, ph.pid DESC LIMIT $2 OFFSET $3"
    ))
    .bind(status)
    .bind(i64::from(page_size))
    .bind(offset)
    .fetch_all(store.pool())
    .await?;
    Ok((read_all(&rows)?, total.max(0) as u32))
}

/// One user by `pid`.
pub(crate) async fn load_user(store: &Store, pid: i64) -> anyhow::Result<Option<UserRecord>> {
    let row = sqlx::query(&format!("{SELECT_USER} WHERE ph.pid = $1"))
        .bind(pid)
        .fetch_optional(store.pool())
        .await?;
    Ok(match row {
        Some(row) => read_user(&row)?,
        None => None,
    })
}

/// Find a user by exact phone (login / uniqueness check).
pub(crate) async fn find_by_phone(
    store: &Store,
    phone: &str,
) -> anyhow::Result<Option<UserRecord>> {
    let row = sqlx::query(&format!("{SELECT_USER} WHERE ph.value = $1"))
        .bind(phone)
        .fetch_optional(store.pool())
        .await?;
    Ok(match row {
        Some(row) => read_user(&row)?,
        None => None,
    })
}

/// Whether any account exists. A COUNT over one table — this runs on every
/// visit to the login page.
pub(crate) async fn users_exist(store: &Store) -> anyhow::Result<bool> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM cmp_userphone)")
            .fetch_one(store.pool())
            .await?,
    )
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
        permissions: if u.is_admin {
            vec!["*".to_string()]
        } else {
            vec![]
        },
    }))
}

// ── Writes ───────────────────────────────────────────────────────────────────

pub(crate) struct NewUser<'a> {
    pub phone: &'a str,
    pub verified: bool,
    pub password_hash: String,
    pub display_name: &'a str,
    pub status: UserStatus,
    /// Also the password's `changed_at` and, for an admin, `granted_at`.
    pub created_at: String,
    pub admin: bool,
}

/// Create a user — every component, and the admin mark if asked — in one
/// transaction. Returns the new `pid`.
pub(crate) async fn create_user(store: &Store, u: NewUser<'_>) -> anyhow::Result<i64> {
    let mut tx = store.pool().begin().await?;
    let pid = entity::new_pid(&mut tx).await?;
    sqlx::query("INSERT INTO cmp_userphone (pid, value, verified) VALUES ($1, $2, $3)")
        .bind(pid)
        .bind(u.phone)
        .bind(u.verified)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO cmp_userpassword (pid, hash, changed_at) VALUES ($1, $2, $3)")
        .bind(pid)
        .bind(&u.password_hash)
        .bind(&u.created_at)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO cmp_userprofile (pid, display_name, avatar_url, email) VALUES ($1, $2, '', '')",
    )
    .bind(pid)
    .bind(u.display_name)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO cmp_userstatuscomponent (pid, status, created_at, last_login_at) \
         VALUES ($1, $2, $3, NULL)",
    )
    .bind(pid)
    .bind(u.status.as_str())
    .bind(&u.created_at)
    .execute(&mut *tx)
    .await?;
    if u.admin {
        sqlx::query("INSERT INTO cmp_adminmark (pid, granted_at) VALUES ($1, $2)")
            .bind(pid)
            .bind(&u.created_at)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(pid)
}

/// Run one component write against `pid` inside a version-bumping transaction.
/// Does nothing when the entity does not exist, as arke's `update` did.
async fn write(
    store: &Store,
    pid: i64,
    q: sqlx::query::Query<'_, sqlx::Postgres, sqlx::postgres::PgArguments>,
) -> anyhow::Result<()> {
    let mut tx = store.pool().begin().await?;
    if entity::touch(&mut tx, pid).await? {
        q.execute(&mut *tx).await?;
        tx.commit().await?;
    }
    Ok(())
}

/// Set the profile fields that are `Some`; leave the rest.
pub(crate) async fn update_profile(
    store: &Store,
    pid: i64,
    display_name: Option<String>,
    avatar_url: Option<String>,
    email: Option<String>,
) -> anyhow::Result<()> {
    let q = sqlx::query(
        "UPDATE cmp_userprofile SET display_name = COALESCE($2, display_name), \
         avatar_url = COALESCE($3, avatar_url), email = COALESCE($4, email) WHERE pid = $1",
    )
    .bind(pid)
    .bind(display_name)
    .bind(avatar_url)
    .bind(email);
    write(store, pid, q).await
}

pub(crate) async fn set_password(
    store: &Store,
    pid: i64,
    hash: String,
    changed_at: String,
) -> anyhow::Result<()> {
    let q = sqlx::query("UPDATE cmp_userpassword SET hash = $2, changed_at = $3 WHERE pid = $1")
        .bind(pid)
        .bind(hash)
        .bind(changed_at);
    write(store, pid, q).await
}

pub(crate) async fn set_status(store: &Store, pid: i64, status: UserStatus) -> anyhow::Result<()> {
    let q = sqlx::query("UPDATE cmp_userstatuscomponent SET status = $2 WHERE pid = $1")
        .bind(pid)
        .bind(status.as_str());
    write(store, pid, q).await
}

pub(crate) async fn set_last_login(store: &Store, pid: i64, at: String) -> anyhow::Result<()> {
    let q = sqlx::query("UPDATE cmp_userstatuscomponent SET last_login_at = $2 WHERE pid = $1")
        .bind(pid)
        .bind(at);
    write(store, pid, q).await
}

/// Grant (re-granting restamps `granted_at`, as arke's insert-overwrites did)
/// or revoke admin. Granting only lands on an entity that is a user.
pub(crate) async fn set_admin(
    store: &Store,
    pid: i64,
    grant: bool,
    granted_at: String,
) -> anyhow::Result<()> {
    let q = if grant {
        sqlx::query(
            "INSERT INTO cmp_adminmark (pid, granted_at) \
             SELECT pid, $2 FROM cmp_userphone WHERE pid = $1 \
             ON CONFLICT (pid) DO UPDATE SET granted_at = EXCLUDED.granted_at",
        )
        .bind(pid)
        .bind(granted_at)
    } else {
        sqlx::query("DELETE FROM cmp_adminmark WHERE pid = $1").bind(pid)
    };
    write(store, pid, q).await
}

pub(crate) async fn delete_user(store: &Store, pid: i64) -> anyhow::Result<()> {
    let mut conn = store.pool().acquire().await?;
    entity::delete(&mut conn, pid).await?;
    Ok(())
}
