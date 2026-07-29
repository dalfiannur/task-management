//! UserDirectoryService: picker (active) + admin user management.

use std::sync::Arc;

use auth::{hash_password, AuthUser};
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::user::{
    password_ok, AdminMark, UserPassword, UserPhone, UserProfile, UserStatus, UserStatusComponent,
};
use persistence::Store;

use super::record::{find_by_phone, load_all_users, load_user, to_proto, UserRecord};
use super::{internal, now_iso, parse_pid};
use crate::sedjiwa::tasks::auth::v1 as pb;
use crate::sedjiwa::tasks::auth::v1::user_directory_service_connect::UserDirectoryServiceBuilder;

fn require_auth(user: Option<Extension<AuthUser>>) -> Result<AuthUser, ConnectError> {
    user.map(|Extension(u)| u)
        .ok_or_else(|| ConnectError::new_unauthenticated("authentication required"))
}

/// Caller must be admin, or an `Active` user (picker access).
async fn require_active(store: &Store, auth: &AuthUser) -> Result<(), ConnectError> {
    if auth.is_admin() {
        return Ok(());
    }
    let pid = parse_pid(&auth.id)?;
    let u = load_user(store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_unauthenticated("unknown user"))?;
    if u.status == UserStatus::Active {
        Ok(())
    } else {
        Err(ConnectError::new_permission_denied("account not active"))
    }
}

fn require_admin(auth: &AuthUser) -> Result<(), ConnectError> {
    if auth.is_admin() {
        Ok(())
    } else {
        Err(ConnectError::new_permission_denied("admin required"))
    }
}

/// Replace a user's status; return the refreshed record.
async fn set_status(
    store: &Store,
    pid: i64,
    status: UserStatus,
) -> Result<UserRecord, ConnectError> {
    store
        .update(pid, move |w, e| {
            if let Some(st) = w.get::<UserStatusComponent>(e).cloned() {
                w.remove::<UserStatusComponent>(e);
                w.insert(
                    e,
                    UserStatusComponent {
                        status: status.as_str().to_string(),
                        ..st
                    },
                );
            }
        })
        .await
        .map_err(internal)?;
    load_user(store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("user not found"))
}

// ── Picker (active users) ───────────────────────────────────────────────────

async fn search_users(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::SearchUsersRequest>,
) -> Result<ConnectResponse<pb::ListUsersResponse>, ConnectError> {
    let auth = require_auth(user)?;
    require_active(&store, &auth).await?;
    let ConnectRequest(r) = req;
    let q = r.q.unwrap_or_default().trim().to_lowercase();
    let users = load_all_users(&store).await.map_err(internal)?;
    let list = users
        .iter()
        .filter(|u| u.status == UserStatus::Active)
        .filter(|u| {
            q.is_empty()
                || u.display_name.to_lowercase().contains(&q)
                || u.phone.to_lowercase().contains(&q)
        })
        .map(to_proto)
        .collect();
    Ok(ConnectResponse::new(pb::ListUsersResponse { users: list }))
}

async fn get_user(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::GetUserRequest>,
) -> Result<ConnectResponse<pb::User>, ConnectError> {
    let auth = require_auth(user)?;
    require_active(&store, &auth).await?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let u = load_user(&store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("user not found"))?;
    Ok(ConnectResponse::new(to_proto(&u)))
}

// ── Admin ────────────────────────────────────────────────────────────────────

async fn list_users(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ListUsersRequest>,
) -> Result<ConnectResponse<pb::ListUsersResponse>, ConnectError> {
    let auth = require_auth(user)?;
    require_admin(&auth)?;
    let ConnectRequest(r) = req;
    let want = r.status; // Option<i32> proto enum
    let users = load_all_users(&store).await.map_err(internal)?;
    let list = users
        .iter()
        .filter(|u| want.is_none_or(|c| u.status.to_proto() == c))
        .map(to_proto)
        .collect();
    Ok(ConnectResponse::new(pb::ListUsersResponse { users: list }))
}

async fn create_user(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::CreateUserRequest>,
) -> Result<ConnectResponse<pb::User>, ConnectError> {
    let auth = require_auth(user)?;
    require_admin(&auth)?;
    let ConnectRequest(r) = req;
    let phone = r.phone.trim();
    let display_name = r.display_name.trim();
    if phone.is_empty() || display_name.is_empty() {
        return Err(ConnectError::new_invalid_argument(
            "phone and display_name are required",
        ));
    }
    if !password_ok(&r.password) {
        return Err(ConnectError::new_invalid_argument(
            "password too short (min 8)",
        ));
    }
    if find_by_phone(&store, phone)
        .await
        .map_err(internal)?
        .is_some()
    {
        return Err(ConnectError::new_already_exists("phone already registered"));
    }
    let hash = hash_password(&r.password).map_err(internal)?;
    let now = now_iso();
    let pid = store
        .create((
            UserPhone {
                value: phone.to_string(),
                verified: false,
            },
            UserPassword {
                hash,
                changed_at: now.clone(),
            },
            UserProfile {
                display_name: display_name.to_string(),
                avatar_url: String::new(),
                email: String::new(),
            },
            UserStatusComponent {
                status: UserStatus::Active.as_str().to_string(),
                created_at: now.clone(),
                last_login_at: None,
            },
        ))
        .await
        .map_err(internal)?;
    if r.is_admin {
        store
            .update(pid, move |w, e| {
                w.insert(e, AdminMark { granted_at: now });
            })
            .await
            .map_err(internal)?;
    }
    let u = load_user(&store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| internal("user missing after create"))?;
    Ok(ConnectResponse::new(to_proto(&u)))
}

async fn update_user(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::UpdateUserRequest>,
) -> Result<ConnectResponse<pb::User>, ConnectError> {
    let auth = require_auth(user)?;
    require_admin(&auth)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    store
        .update(pid, move |w, e| {
            if let Some(p) = w.get::<UserProfile>(e).cloned() {
                w.remove::<UserProfile>(e);
                w.insert(
                    e,
                    UserProfile {
                        display_name: r.display_name.unwrap_or(p.display_name),
                        avatar_url: r.avatar_url.unwrap_or(p.avatar_url),
                        email: r.email.unwrap_or(p.email),
                    },
                );
            }
        })
        .await
        .map_err(internal)?;
    let u = load_user(&store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("user not found"))?;
    Ok(ConnectResponse::new(to_proto(&u)))
}

async fn activate_user(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::UserIdRequest>,
) -> Result<ConnectResponse<pb::User>, ConnectError> {
    let auth = require_auth(user)?;
    require_admin(&auth)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let u = set_status(&store, pid, UserStatus::Active).await?;
    Ok(ConnectResponse::new(to_proto(&u)))
}

async fn suspend_user(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::UserIdRequest>,
) -> Result<ConnectResponse<pb::User>, ConnectError> {
    let auth = require_auth(user)?;
    require_admin(&auth)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let u = set_status(&store, pid, UserStatus::Suspended).await?;
    Ok(ConnectResponse::new(to_proto(&u)))
}

async fn set_admin(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::SetAdminRequest>,
) -> Result<ConnectResponse<pb::User>, ConnectError> {
    let auth = require_auth(user)?;
    require_admin(&auth)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let now = now_iso();
    let grant = r.is_admin;
    store
        .update(pid, move |w, e| {
            if grant {
                w.insert(e, AdminMark { granted_at: now });
            } else {
                w.remove::<AdminMark>(e);
            }
        })
        .await
        .map_err(internal)?;
    let u = load_user(&store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("user not found"))?;
    Ok(ConnectResponse::new(to_proto(&u)))
}

async fn reset_password(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ResetPasswordRequest>,
) -> Result<ConnectResponse<pb::OkResponse>, ConnectError> {
    let auth = require_auth(user)?;
    require_admin(&auth)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    if !password_ok(&r.new_password) {
        return Err(ConnectError::new_invalid_argument(
            "password too short (min 8)",
        ));
    }
    let hash = hash_password(&r.new_password).map_err(internal)?;
    let now = now_iso();
    store
        .update(pid, move |w, e| {
            w.remove::<UserPassword>(e);
            w.insert(
                e,
                UserPassword {
                    hash,
                    changed_at: now,
                },
            );
        })
        .await
        .map_err(internal)?;
    Ok(ConnectResponse::new(pb::OkResponse { ok: true }))
}

async fn delete_user(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::UserIdRequest>,
) -> Result<ConnectResponse<pb::OkResponse>, ConnectError> {
    let auth = require_auth(user)?;
    require_admin(&auth)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    store.delete(pid).await.map_err(internal)?;
    Ok(ConnectResponse::new(pb::OkResponse { ok: true }))
}

/// UserDirectoryService router; injects the Store as a request extension.
pub fn user_router(store: Arc<Store>) -> axum::Router<()> {
    type S = Extension<Arc<Store>>;
    type A = Option<Extension<AuthUser>>;
    UserDirectoryServiceBuilder::<()>::new()
        .search_users::<_, (S, A, ConnectRequest<pb::SearchUsersRequest>)>(search_users)
        .get_user::<_, (S, A, ConnectRequest<pb::GetUserRequest>)>(get_user)
        .list_users::<_, (S, A, ConnectRequest<pb::ListUsersRequest>)>(list_users)
        .create_user::<_, (S, A, ConnectRequest<pb::CreateUserRequest>)>(create_user)
        .update_user::<_, (S, A, ConnectRequest<pb::UpdateUserRequest>)>(update_user)
        .activate_user::<_, (S, A, ConnectRequest<pb::UserIdRequest>)>(activate_user)
        .suspend_user::<_, (S, A, ConnectRequest<pb::UserIdRequest>)>(suspend_user)
        .set_admin::<_, (S, A, ConnectRequest<pb::SetAdminRequest>)>(set_admin)
        .reset_password::<_, (S, A, ConnectRequest<pb::ResetPasswordRequest>)>(reset_password)
        .delete_user::<_, (S, A, ConnectRequest<pb::UserIdRequest>)>(delete_user)
        .build()
        .layer(Extension(store))
}
