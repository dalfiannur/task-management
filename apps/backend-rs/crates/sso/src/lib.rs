//! Single sign-on through the Sedjiwa Portal (OIDC Authorization Code + PKCE,
//! confidential client). An optional module: without the SSO_* settings the
//! routes answer "not configured" and nothing else changes. It signs people in
//! through the core's own rules (`transport::api::issue_login`) and keeps only
//! the link between a portal account and a local user.
//!
//! Browser flow (plain HTTP, mounted at `/sso`):
//! - `GET /sso/start?redirect=/path` → the portal's authorize page. The state
//!   is also set in an HttpOnly cookie, so the callback can only finish a
//!   sign-in this browser started.
//! - `GET /sso/callback` (from the portal) → the app's `/sso/callback` page
//!   with a one-time `code` (60 s, single use), or with `error=<key>`. The
//!   code is bound to this browser by a second HttpOnly cookie: a code alone,
//!   opened in another browser, signs no one in (login CSRF). Tokens never
//!   travel in a URL; the page redeems the code over Connect.

pub mod config;
mod flow;
mod oidc;
pub mod phone;
mod record;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Extension, Router};
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use persistence::Store;
use serde::Deserialize;
use tokio::sync::Mutex;
use transport::api::{auth_pb, issue_login, sso_pb};
use transport::JwtConfig;

pub use config::SsoConfig;
pub use flow::Refusal;

const STATE_COOKIE: &str = "sedjiwa_sso_state";
/// Binds a one-time code to the browser the portal sent back.
const CODE_COOKIE: &str = "sedjiwa_sso_code";
const STATE_TTL: Duration = Duration::from_secs(600);
const CODE_TTL: Duration = Duration::from_secs(60);
/// Unfinished sign-ins kept at once; `/sso/start` is public.
const MAX_PENDING: usize = 10_000;
/// Where the browser lands in the app.
const APP_CALLBACK: &str = "/sso/callback";

struct Pending {
    verifier: String,
    nonce: String,
    redirect: String,
    expires: Instant,
}

struct Issued {
    pid: i64,
    /// The value of this browser's `CODE_COOKIE`.
    binding: String,
    expires: Instant,
}

/// Everything SSO keeps between requests. In memory: one backend instance,
/// and a restart only costs a sign-in in progress.
pub struct Sso {
    client: oidc::Client,
    pending: Mutex<HashMap<String, Pending>>,
    codes: Mutex<HashMap<String, Issued>>,
}

impl Sso {
    pub fn new(cfg: SsoConfig) -> Self {
        Sso {
            client: oidc::Client::new(cfg),
            pending: Mutex::new(HashMap::new()),
            codes: Mutex::new(HashMap::new()),
        }
    }

    /// From the SSO_* env vars; `None` when SSO is off.
    pub fn from_env() -> Option<Arc<Self>> {
        SsoConfig::from_env().map(|c| Arc::new(Sso::new(c)))
    }

    fn secure_cookie(&self) -> bool {
        self.client.config().redirect_uri.starts_with("https://")
    }

    /// A one-time code for `pid` and the browser binding that must come with
    /// it: `(code, binding)`.
    async fn issue_code(&self, pid: i64) -> (String, String) {
        let code = oidc::random_token(32);
        let binding = oidc::random_token(32);
        let mut codes = self.codes.lock().await;
        let now = Instant::now();
        codes.retain(|_, c| c.expires > now);
        codes.insert(code.clone(), Issued { pid, binding: binding.clone(), expires: now + CODE_TTL });
        (code, binding)
    }

    /// The code's user, when it is fresh and comes with its browser's binding;
    /// that spends it. A try from another browser leaves it for the real one
    /// (a code is 32 random bytes: there is nothing to guess).
    async fn redeem(&self, code: &str, binding: Option<&str>) -> Option<i64> {
        let mut codes = self.codes.lock().await;
        let now = Instant::now();
        match codes.get(code) {
            Some(c) if c.expires <= now => {
                codes.remove(code);
                None
            }
            Some(c) if Some(c.binding.as_str()) == binding => codes.remove(code).map(|c| c.pid),
            _ => None,
        }
    }
}

/// `None` = SSO not configured.
#[derive(Clone)]
pub struct SsoExt(pub Option<Arc<Sso>>);

/// Only an app path: absolute (`/…`), not protocol-relative (`//host`), and
/// with no backslash or control character anywhere. Browsers read `\` as
/// `/` and drop tabs and newlines, so `/\evil` or `/<tab>/evil` would
/// otherwise become `//evil` after the check.
fn safe_redirect(r: Option<&str>) -> String {
    match r {
        Some(p)
            if p.starts_with('/')
                && !p.starts_with("//")
                && !p.chars().any(|c| c == '\\' || c.is_control()) =>
        {
            p.to_string()
        }
        _ => "/".to_string(),
    }
}

fn to_app(query: &[(&str, &str)]) -> String {
    let mut url = reqwest::Url::parse("http://app.invalid").expect("static url");
    url.set_path(APP_CALLBACK);
    url.query_pairs_mut().extend_pairs(query);
    format!("{}?{}", url.path(), url.query().unwrap_or_default())
}

fn redirect(location: &str, cookies: &[String]) -> Response {
    let mut r = (StatusCode::FOUND, [(header::LOCATION, location.to_string())]).into_response();
    r.headers_mut().insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    for c in cookies {
        if let Ok(v) = c.parse() {
            r.headers_mut().append(header::SET_COOKIE, v);
        }
    }
    r
}

/// Lax: it must survive the portal's top-level redirect back to us.
fn state_cookie(value: &str, max_age: u64, secure: bool) -> String {
    format!(
        "{STATE_COOKIE}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{}",
        if secure { "; Secure" } else { "" }
    )
}

/// Strict: only the app's own same-origin redeem request ever carries it.
fn code_cookie(value: &str, max_age: u64, secure: bool) -> String {
    format!(
        "{CODE_COOKIE}={value}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}{}",
        if secure { "; Secure" } else { "" }
    )
}

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|kv| kv.trim().split_once('='))
        .find(|(k, _)| *k == name)
        .map(|(_, v)| v.to_string())
}

#[derive(Deserialize)]
struct StartQuery {
    redirect: Option<String>,
}

async fn start(State(sso): State<SsoExt>, Query(q): Query<StartQuery>) -> Response {
    let Some(sso) = sso.0 else {
        return redirect(&to_app(&[("error", "disabled")]), &[]);
    };
    let state = oidc::random_token(32);
    let p = Pending {
        verifier: oidc::random_token(48),
        nonce: oidc::random_token(24),
        redirect: safe_redirect(q.redirect.as_deref()),
        expires: Instant::now() + STATE_TTL,
    };
    let url = match sso.client.authorize_url(&state, &p.nonce, &p.verifier).await {
        Ok(u) => u,
        Err(e) => {
            tracing::warn!(error = %e, "sso: cannot reach the portal to start a sign-in");
            return redirect(&to_app(&[("error", "provider")]), &[]);
        }
    };
    {
        let mut pending = sso.pending.lock().await;
        let now = Instant::now();
        pending.retain(|_, p| p.expires > now);
        if pending.len() >= MAX_PENDING {
            tracing::warn!("sso: too many unfinished sign-ins");
            return redirect(&to_app(&[("error", "busy")]), &[]);
        }
        pending.insert(state.clone(), p);
    }
    redirect(&url, &[state_cookie(&state, STATE_TTL.as_secs(), sso.secure_cookie())])
}

#[derive(Deserialize)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

async fn callback(
    State(sso): State<SsoExt>,
    Extension(store): Extension<Arc<Store>>,
    headers: HeaderMap,
    Query(q): Query<CallbackQuery>,
) -> Response {
    let Some(sso) = sso.0 else {
        return redirect(&to_app(&[("error", "disabled")]), &[]);
    };
    let secure = sso.secure_cookie();
    let clear = state_cookie("", 0, secure);
    let fail = |key: &str| redirect(&to_app(&[("error", key)]), std::slice::from_ref(&clear));

    // The state must be one we issued, to this browser, and still fresh.
    let Some(state) = q.state.filter(|s| !s.is_empty()) else { return fail("expired") };
    let pending = sso.pending.lock().await.remove(&state);
    let Some(p) = pending.filter(|p| p.expires > Instant::now()) else { return fail("expired") };
    if cookie_value(&headers, STATE_COOKIE).as_deref() != Some(state.as_str()) {
        return fail("expired");
    }
    if let Some(e) = q.error {
        tracing::info!(error = %e, "sso: the portal did not sign the user in");
        return fail("denied");
    }
    let Some(code) = q.code.filter(|c| !c.is_empty()) else { return fail("denied") };

    let identity = match sso.client.finish(&code, &p.verifier, &p.nonce).await {
        Ok(i) => i,
        Err(e) => {
            tracing::warn!(error = %e, "sso: code exchange or token verification failed");
            return fail("provider");
        }
    };
    match flow::resolve(&store, &sso.client.config().issuer, &identity).await {
        Ok(flow::Outcome::User(pid)) => {
            let (code, binding) = sso.issue_code(pid).await;
            redirect(
                &to_app(&[("code", &code), ("redirect", &p.redirect)]),
                &[clear.clone(), code_cookie(&binding, CODE_TTL.as_secs(), secure)],
            )
        }
        Ok(flow::Outcome::Refused(r)) => {
            tracing::info!(reason = r.key(), sub = %identity.sub, "sso: sign-in refused");
            fail(r.key())
        }
        Err(e) => {
            tracing::error!(error = %e, "sso: could not resolve the account");
            fail("internal")
        }
    }
}

/// `/sso/start` and `/sso/callback`. Nest at `/sso`, outside the JWT and
/// Connect layers.
pub fn http_router(sso: SsoExt, store: Arc<Store>) -> Router {
    Router::new()
        .route("/start", get(start))
        .route("/callback", get(callback))
        .with_state(sso)
        .layer(Extension(store))
}

// ── Connect ──────────────────────────────────────────────────────────────────

async fn get_sso_config(
    Extension(sso): Extension<SsoExt>,
    _req: ConnectRequest<sso_pb::GetSsoConfigRequest>,
) -> Result<ConnectResponse<sso_pb::SsoConfig>, ConnectError> {
    Ok(ConnectResponse::new(match &sso.0 {
        Some(s) => sso_pb::SsoConfig {
            enabled: true,
            provider_name: s.client.config().provider_name.clone(),
        },
        None => sso_pb::SsoConfig { enabled: false, provider_name: String::new() },
    }))
}

async fn redeem_sso_code(
    Extension(sso): Extension<SsoExt>,
    Extension(store): Extension<Arc<Store>>,
    Extension(jwt): Extension<Arc<JwtConfig>>,
    headers: HeaderMap,
    req: ConnectRequest<sso_pb::RedeemSsoCodeRequest>,
) -> Result<ConnectResponse<auth_pb::LoginResponse>, ConnectError> {
    let Some(sso) = sso.0 else {
        return Err(ConnectError::new_failed_precondition("single sign-on is not configured"));
    };
    let ConnectRequest(r) = req;
    let binding = cookie_value(&headers, CODE_COOKIE);
    let pid = sso
        .redeem(r.code.trim(), binding.as_deref())
        .await
        .ok_or_else(|| ConnectError::new_unauthenticated("this sign-in link has expired; sign in again"))?;
    Ok(ConnectResponse::new(issue_login(&store, &jwt, pid).await?))
}

/// The `SsoService` Connect router. Merge into the Connect API (it answers
/// `enabled: false` when SSO is off).
pub fn connect_router(sso: SsoExt, store: Arc<Store>, jwt: Arc<JwtConfig>) -> Router {
    type R<T> = ConnectRequest<T>;
    sso_pb::sso_service_connect::SsoServiceBuilder::<()>::new()
        .get_sso_config::<_, (Extension<SsoExt>, R<sso_pb::GetSsoConfigRequest>)>(get_sso_config)
        .redeem_sso_code::<_, (
            Extension<SsoExt>,
            Extension<Arc<Store>>,
            Extension<Arc<JwtConfig>>,
            HeaderMap,
            R<sso_pb::RedeemSsoCodeRequest>,
        )>(redeem_sso_code)
        .build()
        .layer(Extension(sso))
        .layer(Extension(store))
        .layer(Extension(jwt))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redirects_stay_on_this_site() {
        assert_eq!(safe_redirect(Some("/projects/1?x=2")), "/projects/1?x=2");
        for bad in [
            "//evil.example",
            "https://evil.example",
            "evil",
            "/\\evil.example",
            "/\t/evil.example",
            "/\n/evil.example",
            "/\r/evil.example",
            "/\t\\evil.example",
            "/ok\u{7f}",
            "",
        ] {
            assert_eq!(safe_redirect(Some(bad)), "/", "{bad}");
        }
        assert_eq!(safe_redirect(None), "/");
    }

    #[test]
    fn app_url_encodes_its_values() {
        assert_eq!(to_app(&[("error", "denied")]), "/sso/callback?error=denied");
        assert_eq!(
            to_app(&[("code", "a b"), ("redirect", "/p?x=1&y=2")]),
            "/sso/callback?code=a+b&redirect=%2Fp%3Fx%3D1%26y%3D2"
        );
    }

    #[test]
    fn reads_one_cookie_among_many() {
        let mut h = HeaderMap::new();
        h.insert(header::COOKIE, "a=1; sedjiwa_sso_state=xyz; b=2".parse().unwrap());
        assert_eq!(cookie_value(&h, STATE_COOKIE).as_deref(), Some("xyz"));
        assert_eq!(cookie_value(&h, "c"), None);
    }

    #[tokio::test]
    async fn a_code_works_once_and_expires() {
        let sso = Sso::new(SsoConfig {
            issuer: "https://portal.example".into(),
            client_id: "id".into(),
            client_secret: "s".into(),
            redirect_uri: "https://pm.example/api/tasks-rs/sso/callback".into(),
            provider_name: "P".into(),
        });
        let (code, bind) = sso.issue_code(7).await;
        assert_eq!(sso.redeem(&code, Some(&bind)).await, Some(7));
        assert_eq!(sso.redeem(&code, Some(&bind)).await, None);
        let (stale, bind) = sso.issue_code(8).await;
        sso.codes.lock().await.get_mut(&stale).unwrap().expires = Instant::now() - Duration::from_secs(1);
        assert_eq!(sso.redeem(&stale, Some(&bind)).await, None);
        // Another browser (no binding, or the wrong one) gets nothing, and
        // the real browser still can.
        let (c, bind) = sso.issue_code(9).await;
        assert_eq!(sso.redeem(&c, None).await, None);
        assert_eq!(sso.redeem(&c, Some("other")).await, None);
        assert_eq!(sso.redeem(&c, Some(&bind)).await, Some(9));
    }
}
