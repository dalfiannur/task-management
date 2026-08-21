//! UserDirectoryService: picker (active) + admin user management.

use std::sync::Arc;

use auth::{hash_password, AuthUser};
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::notification::NotificationType;
use domain::user::{
    password_ok, AdminMark, UserPassword, UserPhone, UserProfile, UserStatus, UserStatusComponent,
};
use persistence::Store;

use super::record::{
    find_by_phone, load_all_users, load_user, load_users_page, to_proto, UserRecord,
};
use super::{internal, now_iso, parse_pid};
use crate::notifications::{emit, NotifRefs, Notifier};
use crate::search::{deindex, index, kind, user_doc};
use crate::sedjiwa::tasks::auth::v1 as pb;
use crate::sedjiwa::tasks::auth::v1::user_directory_service_connect::UserDirectoryServiceBuilder;

/// Page sizing for ListUsers, mirroring `search_service`: a default so a
/// caller may omit it, and a ceiling so one cannot ask for the whole table
/// back by naming a huge page.
const DEFAULT_PAGE_SIZE: u32 = 20;
const MAX_PAGE_SIZE: u32 = 50;

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

/// Refuse an admin action aimed at the caller's own account.
///
/// Suspending yourself, revoking your own admin mark, or deleting yourself all
/// take away the very permission needed to undo them. With a single admin — the
/// normal case — that locks the whole instance out of user management, and the
/// only way back is SQL or the seed binary. Every one of these is reachable by
/// acting on somebody else's account instead, so nothing legitimate is lost.
fn deny_self(target_id: &str, auth: &AuthUser, action: &str) -> Result<(), ConnectError> {
    if target_id == auth.id {
        return Err(ConnectError::new_invalid_argument(format!(
            "cannot {action} your own account; ask another admin"
        )));
    }
    Ok(())
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
) -> Result<ConnectResponse<pb::ListUsersPageResponse>, ConnectError> {
    let auth = require_auth(user)?;
    require_admin(&auth)?;
    let ConnectRequest(r) = req;
    // An unrecognised status enum would silently widen the query to "everyone"
    // if it were treated as absent, so refuse it instead.
    let status = match r.status {
        None => None,
        Some(code) => Some(
            UserStatus::from_proto(code)
                .ok_or_else(|| ConnectError::new_invalid_argument("unknown status"))?,
        ),
    };
    let page = r.page.max(1);
    let page_size = match r.page_size {
        0 => DEFAULT_PAGE_SIZE,
        n => n.min(MAX_PAGE_SIZE),
    };
    let (users, total) = load_users_page(&store, status, page, page_size)
        .await
        .map_err(internal)?;
    Ok(ConnectResponse::new(pb::ListUsersPageResponse {
        users: users.iter().map(to_proto).collect(),
        total,
    }))
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
    index(&store, user_doc(&u.pid.to_string(), &u.display_name, &u.phone)).await;
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
    index(&store, user_doc(&u.pid.to_string(), &u.display_name, &u.phone)).await;
    Ok(ConnectResponse::new(to_proto(&u)))
}

async fn activate_user(
    Extension(store): Extension<Arc<Store>>,
    notifier: Option<Extension<Arc<Notifier>>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::UserIdRequest>,
) -> Result<ConnectResponse<pb::User>, ConnectError> {
    let auth = require_auth(user)?;
    require_admin(&auth)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let u = set_status(&store, pid, UserStatus::Active).await?;
    // Notify the approved user.
    if let Some(Extension(n)) = notifier {
        emit(
            &store,
            &n,
            &pid.to_string(),
            NotificationType::AccountApproved,
            &auth.id,
            "Your account was approved".to_string(),
            NotifRefs::default(),
        )
        .await;
    }
    index(&store, user_doc(&u.pid.to_string(), &u.display_name, &u.phone)).await;
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
    deny_self(&r.id, &auth, "suspend")?;
    let pid = parse_pid(&r.id)?;
    let u = set_status(&store, pid, UserStatus::Suspended).await?;
    deindex(&store, kind::USER, &pid.to_string()).await;
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
    // Granting yourself admin is a no-op (you already are), so this only ever
    // blocks the revoke direction — which is the one that locks you out.
    deny_self(&r.id, &auth, "change the admin flag on")?;
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
    deny_self(&r.id, &auth, "delete")?;
    let pid = parse_pid(&r.id)?;
    store.delete(pid).await.map_err(internal)?;
    deindex(&store, kind::USER, &pid.to_string()).await;
    Ok(ConnectResponse::new(pb::OkResponse { ok: true }))
}

/// UserDirectoryService router; injects the Store as a request extension.
pub fn user_router(store: Arc<Store>) -> axum::Router<()> {
    type S = Extension<Arc<Store>>;
    type A = Option<Extension<AuthUser>>;
    type N = Option<Extension<Arc<Notifier>>>;
    UserDirectoryServiceBuilder::<()>::new()
        .search_users::<_, (S, A, ConnectRequest<pb::SearchUsersRequest>)>(search_users)
        .get_user::<_, (S, A, ConnectRequest<pb::GetUserRequest>)>(get_user)
        .list_users::<_, (S, A, ConnectRequest<pb::ListUsersRequest>)>(list_users)
        .create_user::<_, (S, A, ConnectRequest<pb::CreateUserRequest>)>(create_user)
        .update_user::<_, (S, A, ConnectRequest<pb::UpdateUserRequest>)>(update_user)
        .activate_user::<_, (S, N, A, ConnectRequest<pb::UserIdRequest>)>(activate_user)
        .suspend_user::<_, (S, A, ConnectRequest<pb::UserIdRequest>)>(suspend_user)
        .set_admin::<_, (S, A, ConnectRequest<pb::SetAdminRequest>)>(set_admin)
        .reset_password::<_, (S, A, ConnectRequest<pb::ResetPasswordRequest>)>(reset_password)
        .delete_user::<_, (S, A, ConnectRequest<pb::UserIdRequest>)>(delete_user)
        .build()
        .layer(Extension(store))
}
