//! AuthService: register / login / me / update-my-profile / change-my-password.

use std::sync::Arc;

use auth::{hash_password, sign_jwt, verify_password, AuthUser};
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use domain::user::{
    password_ok, permissions_for, AdminMark, UserPassword, UserPhone, UserProfile, UserStatus,
    UserStatusComponent,
};
use persistence::Store;

use super::record::{find_by_phone, load_user, to_proto};
use super::{internal, now_iso, now_unix, parse_pid, JwtConfig};
use crate::search::{index, user_doc};
use crate::sedjiwa::tasks::auth::v1 as pb;
use crate::sedjiwa::tasks::auth::v1::auth_service_connect::AuthServiceBuilder;

/// Extract the authenticated user or fail with `unauthenticated`.
fn require_auth(user: Option<Extension<AuthUser>>) -> Result<AuthUser, ConnectError> {
    user.map(|Extension(u)| u)
        .ok_or_else(|| ConnectError::new_unauthenticated("authentication required"))
}

/// Serialises the check-then-create in [`setup_first_admin`].
///
/// Counting users and creating the first one are two round trips, and between
/// them a second caller can see the same zero. `Store` exposes neither a
/// transaction nor an advisory lock, so the mutual exclusion lives here, in the
/// process. That is sufficient for the single-instance deployment this serves
/// and **only** that: several backends against one database would each hold
/// their own lock and could both pass. Closing it there needs a database-level
/// guarantee, which means changing `persistence`.
#[derive(Default)]
pub struct SetupGate(tokio::sync::Mutex<()>);

/// Whether the instance has no accounts at all. A COUNT, so it hydrates
/// nothing — this runs on every visit to the login page.
async fn users_exist(store: &Store) -> Result<bool, ConnectError> {
    Ok(store.count::<UserPhone>(None).await.map_err(internal)? > 0)
}

/// Public. Reports whether first-run setup is still available.
///
/// This does reveal one bit to anonymous callers — that the instance is
/// uninitialised — which cannot be avoided, since the setup page has to know
/// whether to show itself. It reveals nothing about an instance that has users.
async fn setup_status(
    Extension(store): Extension<Arc<Store>>,
    _req: ConnectRequest<pb::SetupStatusRequest>,
) -> Result<ConnectResponse<pb::SetupStatusResponse>, ConnectError> {
    Ok(ConnectResponse::new(pb::SetupStatusResponse {
        needed: !users_exist(&store).await?,
    }))
}

/// Public, and only while the instance is empty. Creates the first Active admin
/// and signs it in.
///
/// Gated on "no users at all" rather than "no admins". An instance that has
/// lost its admins but still has ordinary users must NOT reopen an
/// unauthenticated route to adminhood — anyone who knew the URL could take the
/// place over. Recovering from that case is a job for SQL or the `seed_admin`
/// binary, not for a public endpoint.
async fn setup_first_admin(
    Extension(store): Extension<Arc<Store>>,
    Extension(jwt): Extension<Arc<JwtConfig>>,
    Extension(gate): Extension<Arc<SetupGate>>,
    req: ConnectRequest<pb::SetupFirstAdminRequest>,
) -> Result<ConnectResponse<pb::LoginResponse>, ConnectError> {
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

    // Held across the check and the create; see SetupGate.
    let _guard = gate.0.lock().await;
    if users_exist(&store).await? {
        return Err(ConnectError::new_failed_precondition(
            "setup already completed",
        ));
    }

    let now = now_iso();
    let hash = hash_password(&r.password).map_err(internal)?;
    let granted_at = now.clone();
    let pid = store
        .create((
            UserPhone {
                value: phone.to_string(),
                verified: true,
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
                created_at: now,
                last_login_at: None,
            },
        ))
        .await
        .map_err(internal)?;
    store
        .update(pid, move |w, e| {
            w.insert(e, AdminMark { granted_at });
        })
        .await
        .map_err(internal)?;

    let u = load_user(&store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| internal("user missing after create"))?;
    index(&store, user_doc(&pid.to_string(), &u.display_name, &u.phone)).await;

    let perms = permissions_for(true);
    let exp = (now_unix() + jwt.ttl_secs).max(0) as usize;
    let token = sign_jwt(&jwt.secret, &pid.to_string(), &perms, exp).map_err(internal)?;
    Ok(ConnectResponse::new(pb::LoginResponse {
        token,
        user: Some(to_proto(&u)),
    }))
}

/// Public. Self-register → status `Pending` (no token issued).
async fn register(
    Extension(store): Extension<Arc<Store>>,
    req: ConnectRequest<pb::RegisterRequest>,
) -> Result<ConnectResponse<pb::User>, ConnectError> {
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
                status: UserStatus::Pending.as_str().to_string(),
                created_at: now,
                last_login_at: None,
            },
        ))
        .await
        .map_err(internal)?;
    let user = load_user(&store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| internal("user missing after create"))?;
    Ok(ConnectResponse::new(to_proto(&user)))
}

/// Public. Verify credentials; only `Active` may log in. Mints an HS256 JWT.
async fn login(
    Extension(store): Extension<Arc<Store>>,
    Extension(jwt): Extension<Arc<JwtConfig>>,
    req: ConnectRequest<pb::LoginRequest>,
) -> Result<ConnectResponse<pb::LoginResponse>, ConnectError> {
    let ConnectRequest(r) = req;
    let user = find_by_phone(&store, r.phone.trim())
        .await
        .map_err(internal)?;
    // Generic error for bad credentials (never reveal which part failed).
    let Some(user) = user.filter(|u| verify_password(&r.password, &u.password_hash)) else {
        return Err(ConnectError::new_unauthenticated("invalid phone or password"));
    };
    match user.status {
        UserStatus::Pending => {
            return Err(ConnectError::new_failed_precondition(
                "account pending admin approval",
            ));
        }
        UserStatus::Suspended => {
            return Err(ConnectError::new_failed_precondition("account suspended"));
        }
        UserStatus::Active => {}
    }
    let perms = permissions_for(user.is_admin);
    let exp = (now_unix() + jwt.ttl_secs).max(0) as usize;
    let token =
        sign_jwt(&jwt.secret, &user.pid.to_string(), &perms, exp).map_err(internal)?;

    // Stamp last_login_at.
    let now = now_iso();
    store
        .update(user.pid, move |w, e| {
            if let Some(st) = w.get::<UserStatusComponent>(e).cloned() {
                w.remove::<UserStatusComponent>(e);
                w.insert(
                    e,
                    UserStatusComponent {
                        last_login_at: Some(now),
                        ..st
                    },
                );
            }
        })
        .await
        .map_err(internal)?;

    let refreshed = load_user(&store, user.pid)
        .await
        .map_err(internal)?
        .unwrap_or(user);
    Ok(ConnectResponse::new(pb::LoginResponse {
        token,
        user: Some(to_proto(&refreshed)),
    }))
}

/// Authenticated. The current user's profile.
async fn me(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    _req: ConnectRequest<pb::MeRequest>,
) -> Result<ConnectResponse<pb::User>, ConnectError> {
    let auth = require_auth(user)?;
    let pid = parse_pid(&auth.id)?;
    let u = load_user(&store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("user not found"))?;
    Ok(ConnectResponse::new(to_proto(&u)))
}

/// Authenticated (self). Update own display_name/avatar/email (only fields set).
async fn update_my_profile(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::UpdateMyProfileRequest>,
) -> Result<ConnectResponse<pb::User>, ConnectError> {
    let auth = require_auth(user)?;
    let pid = parse_pid(&auth.id)?;
    let ConnectRequest(r) = req;
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

/// Authenticated (self). Verify current password, set a new one.
async fn change_my_password(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::ChangeMyPasswordRequest>,
) -> Result<ConnectResponse<pb::ChangeMyPasswordResponse>, ConnectError> {
    let auth = require_auth(user)?;
    let pid = parse_pid(&auth.id)?;
    let ConnectRequest(r) = req;
    let u = load_user(&store, pid)
        .await
        .map_err(internal)?
        .ok_or_else(|| ConnectError::new_not_found("user not found"))?;
    if !verify_password(&r.current_password, &u.password_hash) {
        return Err(ConnectError::new_failed_precondition(
            "current password is incorrect",
        ));
    }
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
    Ok(ConnectResponse::new(pb::ChangeMyPasswordResponse { ok: true }))
}

/// AuthService router; injects the Store + JWT config as request extensions.
pub fn auth_router(store: Arc<Store>, jwt: Arc<JwtConfig>) -> axum::Router<()> {
    let gate = Arc::new(SetupGate::default());
    AuthServiceBuilder::<()>::new()
        .setup_status::<_, (Extension<Arc<Store>>, ConnectRequest<pb::SetupStatusRequest>)>(
            setup_status,
        )
        .setup_first_admin::<_, (
            Extension<Arc<Store>>,
            Extension<Arc<JwtConfig>>,
            Extension<Arc<SetupGate>>,
            ConnectRequest<pb::SetupFirstAdminRequest>,
        )>(setup_first_admin)
        .register::<_, (Extension<Arc<Store>>, ConnectRequest<pb::RegisterRequest>)>(register)
        .login::<_, (
            Extension<Arc<Store>>,
            Extension<Arc<JwtConfig>>,
            ConnectRequest<pb::LoginRequest>,
        )>(login)
        .me::<_, (
            Extension<Arc<Store>>,
            Option<Extension<AuthUser>>,
            ConnectRequest<pb::MeRequest>,
        )>(me)
        .update_my_profile::<_, (
            Extension<Arc<Store>>,
            Option<Extension<AuthUser>>,
            ConnectRequest<pb::UpdateMyProfileRequest>,
        )>(update_my_profile)
        .change_my_password::<_, (
            Extension<Arc<Store>>,
            Option<Extension<AuthUser>>,
            ConnectRequest<pb::ChangeMyPasswordRequest>,
        )>(change_my_password)
        .build()
        .layer(Extension(store))
        .layer(Extension(jwt))
        .layer(Extension(gate))
}
