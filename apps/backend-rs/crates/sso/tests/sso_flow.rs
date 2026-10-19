//! End-to-end SSO (OIDC) flow: the real `/sso` HTTP routes and `SsoService`
//! Connect router against an in-process fake Sedjiwa Portal (discovery, JWKS,
//! authorize, token with client-secret + PKCE checks, userinfo), on Postgres.
//! Skipped unless `DATABASE_URL` is set.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use axum::body::{to_bytes, Body};
use axum::extract::{Query, Request, State};
use axum::http::header::{CONTENT_TYPE, COOKIE, LOCATION, SET_COOKIE};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Form, Json, Router};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use jsonwebtoken::{encode, EncodingKey, Header};
use persistence::Store;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sso::{Sso, SsoConfig, SsoExt};
use tower::ServiceExt;
use transport::JwtConfig;

const KEY_A_PEM: &str = r"-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDrwpL66dCdC5Zu
prSSqw5K0YBknvH/qc7NTmPxJmxTPT5TBwk6KPFZzA9WhR3IkuLJ+i5wKy7JaMP9
g20N/9wi9YUefUPWu201YXpzuipJ0PNMvZD5tuFnjhUZrAInrPZY4ey2YI+zixDa
PKSL02W+AKiewznpwd0sGD9b8vN5QzBE8RQSR3DSscgiIrwxfrHyzYnt0K36IOn1
4k64lI0DbMqTSHXv69jXIqg+9lyOk5Q9kn6qf5aSu3YPvvNPMQphU9eXN8/6bZH8
bAnWqB3/inKuVHfCwp2WSiVy2WkLiB4TPmy2EgTdq9gy8WiOMgmnqCHZ6oaeHQFY
CGnDpJBtAgMBAAECggEAAZeKpwlN70fUABw0tXFCLsTwLB3EN36O8AnAb6gJTLhz
Comy8kmOasx9V+GvKMP03Sekbf2K8YOUslyTgdWoR8aUkoA9if5opSAGWHlZhRwC
6kjHRINCciw+VN/eJbbwK6Aeoneh9DS8XpMsLyDP6YeAQI56tT1XkBh7rVQp+KWH
kwESsdFDzBxaXdil6LU46OwSYVcfJtulPwl/ddv+8KbIN1u7GQPdSrK/CQJ7tH2p
foGS1nKISTBNnIiPs7e+2gbKNbWDO2wv+36NR/RH6lRBQOh2jEx9uuhqtHWmi8m2
k+Ztv5I9y7vcAetyHDw9+6zxwjm4R9ozzLzMn5WZWQKBgQD2wgmiPth18cJR6N/l
EOQiwfSCIglCzp4CO5F+oSNRyd2i0B3SY8PKloudv0jWEpAeQgVlQVP8LBeeAqPk
X5teZ+mgaGB5BIvTTF27iNi3AU6dJ8pAyryO9V+vrkODSLcKPJi03kG4Qb7Rkiw9
sd1WwI1Rkh6/OV1XZTqhIPvrlQKBgQD0lxYlQsDUxUmtWok/QVYLS6JKw91yaavL
Fypyyk1LoFwOfxSj+9NrX2njMx8NeONXzdpgPguMWR45822vzLhR7LBipw7TWfb/
RP7rhjJ7MnJe0kINtCHj66QrwIl/h19BeSLAC416gnck4Nf9/EDnbVrl6qwlBmIG
1Hq6TXObeQKBgFe3mHcdghNDUsGNV/H09DRK4GFWOhaOnmrKxCjQnV6YtPoIo2FD
57jflVgJRJoc1TB8ZbCd7X4KKocYByzKs892fv1vvUOn0xDU58kfl3JOu6RwHZy0
tRzYqyAngYZs1eyEqAA7tf8LGAslvCZeUQFix5nEqLtvZ/gGWzYmJIeVAoGAShjT
XqpgXJUAAwJgfcc/V+Cr49Z+acDViIsWEvxyeiy0drfM+vi5Tdfz7h54k85BoUH9
nBZvzS7aV1gFrLJqTHdV4C0X8rNYfnDagWOAO45G068Cz7/4XGHwtEh53yaVlvIp
suBNFgYcLhHnnUwkJXgdh3WWfQj3/XW1UGdSVJECgYA4Um87t35WVAPEJPtxUhaS
bxqtgONePLS6ptKwlucqsPGI+6928ohfJqxwHZtV7pVCYizNrFkuS/YaXtleW6ft
OV6IfTC0lwlvMiElFp+t4TZJRavLjy9f91/XdPTH2wdPYxOSgk46WGaRG6RJZsAT
1W3TnU9/GBW0u82vYha3wQ==
-----END PRIVATE KEY-----
";
const KEY_A_N: &str = "68KS-unQnQuWbqa0kqsOStGAZJ7x_6nOzU5j8SZsUz0-UwcJOijxWcwPVoUdyJLiyfoucCsuyWjD_YNtDf_cIvWFHn1D1rttNWF6c7oqSdDzTL2Q-bbhZ44VGawCJ6z2WOHstmCPs4sQ2jyki9NlvgConsM56cHdLBg_W_LzeUMwRPEUEkdw0rHIIiK8MX6x8s2J7dCt-iDp9eJOuJSNA2zKk0h17-vY1yKoPvZcjpOUPZJ-qn-Wkrt2D77zTzEKYVPXlzfP-m2R_GwJ1qgd_4pyrlR3wsKdlkolctlpC4geEz5sthIE3avYMvFojjIJp6gh2eqGnh0BWAhpw6SQbQ";
const KEY_B_PEM: &str = r"-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCwQwazVBzDNoa3
XRoWrlu/x++dk00/9SR4KcOAfmaIzOD8eRhq1+Xs0z/WVuLUNDMZuRIV2bX3qzmz
O4j9gN8rRCdYxzGurT/hrJ8C5zsw3OiS4v/KAnVMQE5i9wjtDeQvk+v8C/EYQEsN
udZneoQiIG4wATDV/sgB97fzEEaxqwXSggqcA21jlc/nGePmRpyOiTLuHz6TV0z5
1mGP7oX+adyStcB8Pku3j/pdpGXKvzZkvmpabUK5383tRKCGhl6fFqcAsL7Q/BAG
9M0YbSmR+xetF+c6eztYQzlRTgdCn72uwyobdF64YE9nuNVS02+01IvUfjhli9QK
vG1DqVVpAgMBAAECggEANAY8go6nhKjh31ov+pTRCMyK+XACQ4foET2GcjUcr3EF
UQ+u+M4rk5iQhYOUpLyZfpSk9WUSc/0KZVADsYspk5wknuwASoXhTotETbeRPW1e
ighNJkNOesiaOlSewlUwzigzZWvi590GKhF5aoZ7XJVE4I9hajAuuYHzvd7Gdua9
f5/BVgoDEcmwtNH+BIyY2vsnfFBK5UThd/ov85t99fmM3oeD6JGfZTj3ZUr3lmj0
PMm/4DyvwXc50JdgcKcZEfwDG1zNuUL5hfWvusxXaS1w7OLi3TQ15CzyEPswz0mb
dgdyVY4deQdMqYXnIP06nw4h8VSAAAMk/h0LCBT7VwKBgQDi/aK3Bax9gWybT8U/
gSpKHBse9rX5UfbrZbjzPR37my291mhTA2VYiZCLw03EZWR+FfrUrGOtaR2xfDxD
PTh8YavGmIuO4iQgVFR6lQA3bWrj60yFXw7b8R2yOjkS8YynerLXHMgUJuVl3P+s
B6SdwAoPHYyRlnceVvKBpHh09wKBgQDGybZfhVQpuiSsN4fZKPjPCplmvCTQDqHP
GhW+ITgol6Lp8vLrEnxFDnSTL54rsn2amz7yeSAaCpwEy0aQ1YJZQYaTNJrhOh5G
A3WV+49hCldb5jfUEagw5F3APMNyQyjfuNpACwjdnTBhTyJrVAgv+fSlO3ey29Lg
BcaHzLDQnwKBgBL3ZnUsgDEsc0q266BWxpXSq2F289WVR7B7m2yXmr2/RZ8rHyRw
kDNJq05CT2ktn6v5YjALB3kh411FKDPmFaYu8w9xB5g0xRf+c+CaOp5nAhtxOb+b
Jb6y8uxFeSdgD4Se9/qJaR5l8Z0FTketi8+ykCSbL3eqvuFGGpVCjN4ZAoGAHzDJ
L8WwxfdSB7+Szi0SlRHZrff5YrfZBbDXFoUJ1bytMD4RhXbaDs/M1MdU7xBLivWu
88azlcJyZoIqqVEG6dBROEm5v3sqAtxKF+Vnwtcni+Dcg6bdmAZM+3vNQuFsyWWs
wP26P2OJkssi4GpH+pcinsZs6qB5PvNJCkfAuosCgYBz13Qd0cWoXk2zM5zQIEXS
Q2Ec1FejX1U00PnSSniMb1RuG9plLV3sz/aQT9IJBfFcFCmLV5vGuG6kAnj7x6y4
mrKPtlwkkXfWEeD5aXHLnZ8DILmzxkajLEqwmkC97XX514z4FNmEAtuPJUjq8tXN
wQQM1+3gNQZSTkZBuAvRmA==
-----END PRIVATE KEY-----
";
const KEY_B_N: &str = "sEMGs1QcwzaGt10aFq5bv8fvnZNNP_UkeCnDgH5miMzg_HkYatfl7NM_1lbi1DQzGbkSFdm196s5szuI_YDfK0QnWMcxrq0_4ayfAuc7MNzokuL_ygJ1TEBOYvcI7Q3kL5Pr_AvxGEBLDbnWZ3qEIiBuMAEw1f7IAfe38xBGsasF0oIKnANtY5XP5xnj5kacjoky7h8-k1dM-dZhj-6F_mnckrXAfD5Lt4_6XaRlyr82ZL5qWm1Cud_N7USghoZenxanALC-0PwQBvTNGG0pkfsXrRfnOns7WEM5UU4HQp-9rsMqG3ReuGBPZ7jVUtNvtNSL1H44ZYvUCrxtQ6lVaQ";

const SECRET: &str = "test-secret";
const CLIENT_ID: &str = "pm-test";
const CLIENT_SECRET: &str = "pm-test-secret";
const REDIRECT_URI: &str = "http://pm.test/api/tasks-rs/sso/callback";
const SSO: &str = "/sedjiwa.tasks.sso.v1.SsoService";
const AUTH: &str = "/sedjiwa.tasks.auth.v1.AuthService";

// ── fake portal ──────────────────────────────────────────────────────────────

#[derive(Default)]
struct Idp {
    iss: String,
    /// Who the next authorize signs in as, plus an optional `mode`.
    next: Value,
    codes: HashMap<String, (String, String, String, Value)>, // nonce, challenge, redirect_uri, who
    tokens: HashMap<String, Value>,
    /// (kid, n) published in the JWKS.
    published: Vec<(String, String)>,
    jwks_fetches: usize,
}

type Shared = Arc<Mutex<Idp>>;

async fn discovery(State(s): State<Shared>) -> Json<Value> {
    let iss = s.lock().unwrap().iss.clone();
    Json(json!({
        "issuer": iss,
        "authorization_endpoint": format!("{iss}/oauth/authorize"),
        "token_endpoint": format!("{iss}/oauth/token"),
        "jwks_uri": format!("{iss}/jwks"),
        "userinfo_endpoint": format!("{iss}/userinfo"),
    }))
}

async fn jwks(State(s): State<Shared>) -> Json<Value> {
    let mut g = s.lock().unwrap();
    g.jwks_fetches += 1;
    let keys: Vec<Value> = g
        .published
        .iter()
        .map(|(kid, n)| json!({ "kty": "RSA", "kid": kid, "use": "sig", "alg": "RS256", "n": n, "e": "AQAB" }))
        .collect();
    Json(json!({ "keys": keys }))
}

async fn authorize(State(s): State<Shared>, Query(q): Query<HashMap<String, String>>) -> axum::response::Response {
    let mut g = s.lock().unwrap();
    let who = g.next.clone();
    let back = &q["redirect_uri"];
    let loc = if who["mode"] == "deny" {
        format!("{back}?error=access_denied&state={}", q["state"])
    } else {
        let code = format!("c{}", next_n());
        g.codes.insert(code.clone(), (q["nonce"].clone(), q["code_challenge"].clone(), back.clone(), who));
        format!("{back}?code={code}&state={}", q["state"])
    };
    (StatusCode::FOUND, [(LOCATION, loc)]).into_response()
}

async fn token(State(s): State<Shared>, Form(f): Form<HashMap<String, String>>) -> axum::response::Response {
    let mut g = s.lock().unwrap();
    if f.get("client_id").map(String::as_str) != Some(CLIENT_ID)
        || f.get("client_secret").map(String::as_str) != Some(CLIENT_SECRET)
    {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "invalid_client" }))).into_response();
    }
    let Some((nonce, challenge, redirect_uri, who)) = f.get("code").and_then(|c| g.codes.remove(c)) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid_grant" }))).into_response();
    };
    let verifier = f.get("code_verifier").cloned().unwrap_or_default();
    if URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())) != challenge
        || f.get("redirect_uri") != Some(&redirect_uri)
    {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid_grant" }))).into_response();
    }
    let mode = who["mode"].as_str().unwrap_or("");
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let mut claims = json!({
        "iss": if mode == "wrong_iss" { "https://evil.example".to_string() } else { g.iss.clone() },
        "aud": if mode == "wrong_aud" { "someone-else" } else { CLIENT_ID },
        "sub": who["sub"],
        "iat": now,
        "exp": if mode == "expired" { now - 3_600 } else { now + 300 },
        "nonce": if mode == "bad_nonce" { "wrong".to_string() } else { nonce },
    });
    if mode == "claims_in_id_token" {
        for k in ["name", "email", "phone_number", "phone_number_verified"] {
            if !who[k].is_null() { claims[k] = who[k].clone(); }
        }
    }
    let (kid, pem) = match mode {
        "bad_sig" => ("k1", KEY_B_PEM),
        "rotated" => ("k2", KEY_B_PEM),
        _ => ("k1", KEY_A_PEM),
    };
    if mode == "rotated" && !g.published.iter().any(|(k, _)| k == "k2") {
        g.published.push(("k2".into(), KEY_B_N.into()));
    }
    let mut h = Header::new(jsonwebtoken::Algorithm::RS256);
    h.kid = Some(kid.into());
    let idt = encode(&h, &claims, &EncodingKey::from_rsa_pem(pem.as_bytes()).unwrap()).unwrap();
    let at = format!("at{}", next_n());
    let mut info = json!({ "sub": if mode == "userinfo_other_sub" { json!("someone-else") } else { who["sub"].clone() } });
    if mode != "claims_in_id_token" {
        for k in ["name", "email", "phone_number", "phone_number_verified"] {
            if !who[k].is_null() { info[k] = who[k].clone(); }
        }
    }
    g.tokens.insert(at.clone(), info);
    let mut body = json!({ "access_token": at, "token_type": "Bearer", "expires_in": 300, "id_token": idt });
    if mode == "no_id_token" {
        body.as_object_mut().unwrap().remove("id_token");
    }
    Json(body).into_response()
}

async fn userinfo(State(s): State<Shared>, headers: HeaderMap) -> axum::response::Response {
    let g = s.lock().unwrap();
    let tok = headers.get("authorization").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).unwrap_or("");
    match g.tokens.get(tok) {
        Some(info) => Json(info.clone()).into_response(),
        None => StatusCode::UNAUTHORIZED.into_response(),
    }
}

async fn start_idp() -> Shared {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let iss = format!("http://{}", listener.local_addr().unwrap());
    let s: Shared = Arc::new(Mutex::new(Idp {
        iss,
        published: vec![("k1".into(), KEY_A_N.into())],
        ..Default::default()
    }));
    let app = Router::new()
        .route("/.well-known/openid-configuration", get(discovery))
        .route("/jwks", get(jwks))
        .route("/oauth/authorize", get(authorize))
        .route("/oauth/token", post(token))
        .route("/userinfo", get(userinfo))
        .with_state(s.clone());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    s
}

// ── harness ──────────────────────────────────────────────────────────────────

static N: AtomicU64 = AtomicU64::new(0);
fn next_n() -> u64 {
    N.fetch_add(1, Ordering::Relaxed)
}

/// A phone number no other test (or earlier run) uses: 0812 + 9 digits.
fn fresh_local() -> String {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos() as u64;
    format!("{:09}", (nanos / 1000 + next_n() * 7_919) % 1_000_000_000)
}

struct H {
    router: Router,
    store: Arc<Store>,
    idp: Shared,
}

async fn setup() -> Option<H> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let store = Arc::new(Store::connect(&url).await.unwrap());
    let idp = start_idp().await;
    let issuer = idp.lock().unwrap().iss.clone();
    let ext = SsoExt(Some(Arc::new(Sso::new(SsoConfig {
        issuer,
        client_id: CLIENT_ID.into(),
        client_secret: CLIENT_SECRET.into(),
        redirect_uri: REDIRECT_URI.into(),
        provider_name: "Sedjiwa Portal".into(),
    }))));
    Some(H { router: router_for(ext, store.clone()), store, idp })
}

fn router_for(ext: SsoExt, store: Arc<Store>) -> Router {
    let jwt = Arc::new(JwtConfig { secret: SECRET.into(), ttl_secs: 3_600 });
    Router::new()
        .nest("/sso", sso::http_router(ext.clone(), store.clone()))
        .merge(sso::connect_router(ext, store.clone(), jwt.clone()))
        .merge(transport::auth_router(store, jwt))
}

struct Resp {
    status: StatusCode,
    location: String,
    set_cookies: Vec<String>,
    body: Value,
}

async fn send(router: &Router, method: &str, uri: &str, cookie: Option<&str>, body: Option<Value>) -> Resp {
    let mut b = Request::builder().method(method).uri(uri);
    if let Some(c) = cookie {
        b = b.header(COOKIE, c);
    }
    let req = match body {
        Some(v) => b.header(CONTENT_TYPE, "application/json").body(Body::from(v.to_string())).unwrap(),
        None => b.body(Body::empty()).unwrap(),
    };
    let resp = router.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let location = resp.headers().get(LOCATION).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let set_cookies = resp
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok().map(str::to_string))
        .collect();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    Resp { status, location, set_cookies, body: serde_json::from_slice(&bytes).unwrap_or(Value::Null) }
}

fn query_of(url: &str) -> HashMap<String, String> {
    let q = url.split_once('?').map(|(_, q)| q).unwrap_or("");
    reqwest::Url::parse(&format!("http://x/?{q}"))
        .unwrap()
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect()
}

/// `name=value` pairs of Set-Cookie headers, as a Cookie header.
fn cookie_header(set: &[String]) -> String {
    set.iter()
        .filter_map(|c| c.split(';').next())
        .filter(|kv| kv.split_once('=').is_some_and(|(_, v)| !v.is_empty()))
        .collect::<Vec<_>>()
        .join("; ")
}

/// One browser sign-in, start to the app page.
struct Flow {
    start_cookies: Vec<String>,
    /// The app page `/sso/callback` sent the browser to.
    app: String,
    app_cookies: Vec<String>,
}

impl Flow {
    fn q(&self) -> HashMap<String, String> {
        query_of(&self.app)
    }
    fn error(&self) -> Option<String> {
        self.q().get("error").cloned()
    }
    fn code(&self) -> String {
        self.q().get("code").cloned().unwrap_or_else(|| panic!("no code: {}", self.app))
    }
    /// Everything this browser holds after the callback.
    fn browser_cookies(&self) -> String {
        let mut all = self.start_cookies.clone();
        all.extend(self.app_cookies.iter().cloned());
        // Later Set-Cookie with the same name wins.
        let mut by_name: Vec<(String, String)> = Vec::new();
        for c in all {
            let kv = c.split(';').next().unwrap_or("").to_string();
            if let Some((k, _)) = kv.split_once('=') {
                by_name.retain(|(n, _)| n != k);
                by_name.push((k.to_string(), kv.clone()));
            }
        }
        cookie_header(&by_name.into_iter().map(|(_, kv)| kv).collect::<Vec<_>>())
    }
}

async fn portal_redirect(authorize: &str) -> String {
    let http = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().unwrap();
    let r = http.get(authorize).send().await.unwrap();
    assert_eq!(r.status(), 302, "fake portal authorize");
    r.headers()[LOCATION.as_str()].to_str().unwrap().to_string()
}

impl H {
    fn next(&self, who: Value) {
        self.idp.lock().unwrap().next = who;
    }

    async fn start(&self, redirect: &str) -> Resp {
        let mut u = reqwest::Url::parse("http://x/sso/start").unwrap();
        u.query_pairs_mut().append_pair("redirect", redirect);
        send(&self.router, "GET", &format!("/sso/start?{}", u.query().unwrap()), None, None).await
    }

    /// The portal's callback, with whatever cookie the browser has.
    async fn callback(&self, back: &str, cookie: Option<&str>) -> Resp {
        let q = back.split_once('?').map(|(_, q)| q).unwrap_or("");
        send(&self.router, "GET", &format!("/sso/callback?{q}"), cookie, None).await
    }

    async fn sign_in(&self, who: Value, redirect: &str) -> Flow {
        self.next(who);
        let s = self.start(redirect).await;
        assert_eq!(s.status, StatusCode::FOUND, "start redirects");
        let back = portal_redirect(&s.location).await;
        let c = self.callback(&back, Some(&cookie_header(&s.set_cookies))).await;
        assert_eq!(c.status, StatusCode::FOUND, "callback redirects");
        Flow { start_cookies: s.set_cookies, app: c.location, app_cookies: c.set_cookies }
    }

    async fn redeem(&self, code: &str, cookie: Option<&str>) -> Resp {
        send(&self.router, "POST", &format!("{SSO}/RedeemSsoCode"), cookie, Some(json!({ "code": code }))).await
    }

    /// Sign in and redeem from the same browser; the LoginResponse.
    async fn login(&self, who: Value) -> Value {
        let f = self.sign_in(who, "/").await;
        assert_eq!(f.error(), None, "sign-in refused: {}", f.app);
        let r = self.redeem(&f.code(), Some(&f.browser_cookies())).await;
        assert_eq!(r.status, StatusCode::OK, "redeem: {}", r.body);
        r.body
    }

    async fn pids_with_local(&self, local: &str) -> Vec<i64> {
        let variants = [format!("0{local}"), local.to_string(), format!("62{local}"), format!("+62{local}")];
        sqlx::query_scalar("SELECT pid FROM cmp_userphone WHERE value = ANY($1) ORDER BY pid")
            .bind(&variants[..])
            .fetch_all(self.store.pool())
            .await
            .unwrap()
    }

    async fn link_of(&self, pid: i64) -> Option<String> {
        sqlx::query_scalar("SELECT subject FROM cmp_ssoidentity WHERE pid = $1")
            .bind(pid)
            .fetch_optional(self.store.pool())
            .await
            .unwrap()
    }

    async fn links_of_sub(&self, sub: &str) -> i64 {
        sqlx::query_scalar("SELECT count(*) FROM cmp_ssoidentity WHERE subject = $1")
            .bind(sub)
            .fetch_one(self.store.pool())
            .await
            .unwrap()
    }

    async fn set_status(&self, pid: i64, status: &str) {
        sqlx::query("UPDATE cmp_userstatuscomponent SET status = $2 WHERE pid = $1")
            .bind(pid)
            .bind(status)
            .execute(self.store.pool())
            .await
            .unwrap();
    }

    /// An existing account here, stored with this exact phone spelling.
    async fn seed_account(&self, phone: &str, name: &str) -> i64 {
        transport::api::create_external_user(&self.store, phone, true, name, "", "2026-01-01T00:00:00Z".into())
            .await
            .unwrap()
    }

    /// A password account the way people make one: Register, then approved.
    async fn seed_password_account(&self, phone: &str, password: &str) -> i64 {
        let r = send(&self.router, "POST", &format!("{AUTH}/Register"), None,
            Some(json!({ "phone": phone, "password": password, "displayName": "Pat Password" }))).await;
        assert_eq!(r.status, StatusCode::OK, "register: {}", r.body);
        let pid: i64 = r.body["id"].as_str().unwrap().parse().unwrap();
        self.set_status(pid, "active").await;
        pid
    }

    async fn password_login(&self, phone: &str, password: &str) -> Resp {
        send(&self.router, "POST", &format!("{AUTH}/Login"), None, Some(json!({ "phone": phone, "password": password }))).await
    }
}

fn who(sub: &str, phone: &str, verified: bool) -> Value {
    json!({ "sub": sub, "name": "Portal Person", "email": "p@portal.example", "phone_number": phone, "phone_number_verified": verified })
}

fn sub() -> String {
    format!("portal-{}-{}", fresh_local(), next_n())
}

macro_rules! setup_or_skip {
    () => {
        match setup().await {
            Some(h) => h,
            None => {
                eprintln!("skip: DATABASE_URL not set");
                return;
            }
        }
    };
}

// ── tests ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn with_sso_off_every_entry_point_says_so() {
    let Ok(url) = std::env::var("DATABASE_URL") else { eprintln!("skip: DATABASE_URL not set"); return };
    let store = Arc::new(Store::connect(&url).await.unwrap());
    let router = router_for(SsoExt(None), store);
    let c = send(&router, "POST", &format!("{SSO}/GetSsoConfig"), None, Some(json!({}))).await;
    assert_eq!(c.status, StatusCode::OK);
    assert_eq!(c.body["enabled"].as_bool().unwrap_or(false), false, "off: {}", c.body);
    for path in ["/sso/start?redirect=%2Fx", "/sso/callback?code=a&state=b"] {
        let r = send(&router, "GET", path, None, None).await;
        assert_eq!(r.status, StatusCode::FOUND, "{path}");
        assert_eq!(query_of(&r.location).get("error").map(String::as_str), Some("disabled"), "{path} → {}", r.location);
        assert!(r.location.starts_with("/sso/callback?"), "lands on the app page: {}", r.location);
    }
    let r = send(&router, "POST", &format!("{SSO}/RedeemSsoCode"), None, Some(json!({ "code": "x" }))).await;
    assert_eq!(r.body["code"], "failed_precondition", "redeem when off: {}", r.body);
}

#[tokio::test]
async fn start_sends_the_browser_to_the_portal_with_pkce_and_a_state_cookie() {
    let h = setup_or_skip!();
    let c = send(&h.router, "POST", &format!("{SSO}/GetSsoConfig"), None, Some(json!({}))).await;
    assert_eq!(c.body["enabled"], true);
    assert_eq!(c.body["providerName"], "Sedjiwa Portal");

    let s = h.start("/projects/1").await;
    assert_eq!(s.status, StatusCode::FOUND);
    let iss = h.idp.lock().unwrap().iss.clone();
    assert!(s.location.starts_with(&format!("{iss}/oauth/authorize?")), "{}", s.location);
    let q = query_of(&s.location);
    assert_eq!(q["response_type"], "code");
    assert_eq!(q["client_id"], CLIENT_ID);
    assert_eq!(q["redirect_uri"], REDIRECT_URI);
    let mut scope: Vec<&str> = q["scope"].split(' ').collect();
    scope.sort();
    assert_eq!(scope, ["email", "openid", "phone", "profile"]);
    assert_eq!(q["code_challenge_method"], "S256");
    assert_eq!(q["code_challenge"].len(), 43, "a base64url SHA-256");
    assert!(q["state"].len() >= 32 && q["nonce"].len() >= 16, "state and nonce are long random values");
    assert!(!q.contains_key("client_secret"), "the secret never goes to the browser");
    let cookie = s.set_cookies.iter().find(|c| c.starts_with("sedjiwa_sso_state=")).expect("state cookie");
    assert!(cookie.starts_with(&format!("sedjiwa_sso_state={};", q["state"])), "{cookie}");
    for attr in ["HttpOnly", "SameSite=Lax", "Path=/"] {
        assert!(cookie.contains(attr), "{attr} in {cookie}");
    }
    assert!(!cookie.contains("Secure"), "plain http redirect uri → no Secure flag: {cookie}");

    // Two starts never share a state, nonce or challenge.
    let q2 = query_of(&h.start("/").await.location);
    assert_ne!(q["state"], q2["state"]);
    assert_ne!(q["nonce"], q2["nonce"]);
    assert_ne!(q["code_challenge"], q2["code_challenge"]);
}

#[tokio::test]
async fn a_new_portal_user_gets_an_active_member_account_and_the_code_works_once() {
    let h = setup_or_skip!();
    let local = format!("812{}", fresh_local());
    let s = sub();
    let f = h.sign_in(who(&s, &format!("+62 {local}"), true), "/projects/9?tab=timeline").await;
    assert_eq!(f.error(), None, "{}", f.app);
    assert!(f.app.starts_with("/sso/callback?"), "{}", f.app);
    assert_eq!(f.q()["redirect"], "/projects/9?tab=timeline", "the redirect survives the round trip");
    assert!(!f.app.contains("token"), "no token in a URL: {}", f.app);
    let clear = f.app_cookies.iter().find(|c| c.starts_with("sedjiwa_sso_state=")).expect("callback clears the state cookie");
    assert!(clear.contains("Max-Age=0"), "{clear}");

    let r = h.redeem(&f.code(), Some(&f.browser_cookies())).await;
    assert_eq!(r.status, StatusCode::OK, "redeem: {}", r.body);
    let user = &r.body["user"];
    assert!(r.body["token"].as_str().is_some_and(|t| t.split('.').count() == 3), "a JWT: {}", r.body);
    assert_eq!(user["phone"], format!("0{local}").as_str(), "stored in the canonical 08… form");
    assert_eq!(user["displayName"], "Portal Person");
    assert_eq!(user["email"], "p@portal.example");
    assert_eq!(user["status"], "ACTIVE", "{user}");
    let mut v = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::HS256);
    v.validate_aud = false;
    let claims = jsonwebtoken::decode::<Value>(
        r.body["token"].as_str().unwrap(),
        &jsonwebtoken::DecodingKey::from_secret(SECRET.as_bytes()),
        &v,
    )
    .expect("signed with the app's own key");
    assert_eq!(claims.claims["sub"], user["id"], "for this user");
    let perms = claims.claims["permissions"].as_array().cloned().unwrap_or_default();
    assert!(!perms.iter().any(|p| p == "*"), "never an admin: {perms:?}");
    assert!(user["lastLoginAt"].as_str().is_some_and(|s| !s.is_empty()), "last login stamped: {user}");

    let again = h.redeem(&f.code(), Some(&f.browser_cookies())).await;
    assert_eq!(again.body["code"], "unauthenticated", "a code redeems once: {}", again.body);
    let bogus = h.redeem("not-a-code", Some(&f.browser_cookies())).await;
    assert_eq!(bogus.body["code"], "unauthenticated");

    let pids = h.pids_with_local(&local).await;
    assert_eq!(pids.len(), 1, "exactly one account");
    assert_eq!(h.link_of(pids[0]).await.as_deref(), Some(s.as_str()), "and it is linked");
    let verified: bool = sqlx::query_scalar("SELECT verified FROM cmp_userphone WHERE pid = $1")
        .bind(pids[0]).fetch_one(h.store.pool()).await.unwrap();
    assert!(verified, "the phone is stored as verified: the portal verified it");

    // Signing in again is the same account, not a second one.
    let again = h.login(who(&s, &format!("0{local}"), true)).await;
    assert_eq!(again["user"]["id"], user["id"]);
    assert_eq!(h.pids_with_local(&local).await.len(), 1, "still one account");

    // The created account has no usable password.
    for pw in ["", "password", "Portal Person"] {
        let r = h.password_login(&format!("0{local}"), pw).await;
        assert_ne!(r.status, StatusCode::OK, "password `{pw}` must not work");
    }
}

#[tokio::test]
async fn a_new_account_falls_back_to_the_phone_for_its_name() {
    let h = setup_or_skip!();
    let local = format!("813{}", fresh_local());
    let r = h.login(json!({ "sub": sub(), "name": "   ", "phone_number": format!("0{local}"), "phone_number_verified": true })).await;
    assert_eq!(r["user"]["displayName"], format!("0{local}").as_str(), "{r}");
    assert_eq!(r["user"]["email"].as_str().unwrap_or(""), "", "no email from the portal → none here");
}

#[tokio::test]
async fn claims_only_in_the_id_token_are_enough() {
    let h = setup_or_skip!();
    let local = format!("814{}", fresh_local());
    let mut w = who(&sub(), &format!("0{local}"), true);
    w["mode"] = json!("claims_in_id_token");
    let r = h.login(w).await;
    assert_eq!(r["user"]["phone"], format!("0{local}").as_str(), "{r}");
}

#[tokio::test]
async fn a_verified_phone_links_the_existing_account_in_any_spelling() {
    let h = setup_or_skip!();
    for (stored, portal) in [("0{}", "+62{}"), ("{}", "0{}"), ("62{}", "{}"), ("+62{}", "62{}")] {
        let local = format!("815{}", fresh_local());
        let pid = h.seed_account(&stored.replace("{}", &local), "Own Name").await;
        let s = sub();
        let r = h.login(who(&s, &portal.replace("{}", &local), true)).await;
        assert_eq!(r["user"]["id"], pid.to_string().as_str(), "stored {stored} ↔ portal {portal}");
        assert_eq!(r["user"]["displayName"], "Own Name", "the account keeps its own name");
        assert_eq!(h.link_of(pid).await.as_deref(), Some(s.as_str()));
        assert_eq!(h.pids_with_local(&local).await, vec![pid], "no second account");
    }
}

#[tokio::test]
async fn a_verified_phone_links_an_account_stored_with_spaces_or_dashes() {
    let h = setup_or_skip!();
    let local = format!("816{}", fresh_local());
    // Register keeps the phone as typed (trimmed only).
    let mut cases = Vec::new();
    for shape in 0..3 {
        let l = format!("816{}", fresh_local());
        let stored = match shape {
            0 => format!("0{} {} {}", &l[..3], &l[3..7], &l[7..]),
            1 => format!("+62 ({}) {}-{}", &l[..3], &l[3..7], &l[7..]),
            _ => format!("62-{}-{}", &l[..3], &l[3..]),
        };
        cases.push((l, stored));
    }
    cases.push((local.clone(), format!("0{} {} {}", &local[..3], &local[3..7], &local[7..])));
    for (l, stored) in cases {
        let pid = h.seed_password_account(&stored, "pw-123456").await;
        let r = h.login(who(&sub(), &format!("+62{l}"), true)).await;
        assert_eq!(r["user"]["id"], pid.to_string().as_str(), "stored {stored:?}: linked, not a second account: {r}");
    }
    // A number that merely ends with the same digits is someone else.
    let l = format!("817{}", fresh_local());
    let other = h.seed_account(&format!("0{l}"), "Other").await;
    let longer = format!("9{l}");
    let r = h.login(who(&sub(), &format!("0{longer}"), true)).await;
    assert_ne!(r["user"]["id"], other.to_string().as_str(), "a suffix match is not a match: {r}");
}

#[tokio::test]
async fn a_linked_password_account_keeps_its_password() {
    let h = setup_or_skip!();
    let local = format!("817{}", fresh_local());
    let phone = format!("0{local}");
    let pid = h.seed_password_account(&phone, "pw-123456").await;
    let r = h.login(who(&sub(), &phone, true)).await;
    assert_eq!(r["user"]["id"], pid.to_string().as_str());
    let p = h.password_login(&phone, "pw-123456").await;
    assert_eq!(p.status, StatusCode::OK, "password login still works: {}", p.body);
    assert_eq!(p.body["user"]["id"], pid.to_string().as_str());
    assert_ne!(h.password_login(&phone, "wrong").await.status, StatusCode::OK);
}

#[tokio::test]
async fn refusals_link_and_create_nothing() {
    let h = setup_or_skip!();

    // Unverified phone that is taken.
    let local = format!("818{}", fresh_local());
    let owner = h.seed_account(&format!("0{local}"), "Owner").await;
    let s = sub();
    let f = h.sign_in(who(&s, &format!("0{local}"), false), "/").await;
    assert_eq!(f.error().as_deref(), Some("phone_unverified"), "{}", f.app);
    assert_eq!(h.link_of(owner).await, None, "not linked");
    assert_eq!(h.links_of_sub(&s).await, 0);
    assert_eq!(h.pids_with_local(&local).await, vec![owner], "nothing created");
    assert!(!f.app.contains("code="), "no code on a refusal");
    // A missing `phone_number_verified` counts as unverified.
    let f = h.sign_in(json!({ "sub": s, "phone_number": format!("0{local}") }), "/").await;
    assert_eq!(f.error().as_deref(), Some("phone_unverified"));

    // Several accounts with the number.
    let local = format!("819{}", fresh_local());
    let a = h.seed_account(&format!("0{local}"), "A").await;
    let b = h.seed_account(&local, "B").await;
    let s = sub();
    let f = h.sign_in(who(&s, &format!("+62{local}"), true), "/").await;
    assert_eq!(f.error().as_deref(), Some("ambiguous"), "{}", f.app);
    assert_eq!((h.link_of(a).await, h.link_of(b).await), (None, None));
    assert_eq!(h.pids_with_local(&local).await.len(), 2, "nothing created");

    // No phone at all, or one that is no number.
    for w in [json!({ "sub": s }), json!({ "sub": s, "phone_number": "" }), json!({ "sub": s, "phone_number": "n/a", "phone_number_verified": true })] {
        let f = h.sign_in(w.clone(), "/").await;
        assert_eq!(f.error().as_deref(), Some("no_phone"), "{w}: {}", f.app);
    }
    assert_eq!(h.links_of_sub(&s).await, 0);

    // The account is already linked to another portal account.
    let local = format!("820{}", fresh_local());
    let first = sub();
    let r = h.login(who(&first, &format!("0{local}"), true)).await;
    let pid: i64 = r["user"]["id"].as_str().unwrap().parse().unwrap();
    let second = sub();
    let f = h.sign_in(who(&second, &format!("0{local}"), true), "/").await;
    assert_eq!(f.error().as_deref(), Some("linked_elsewhere"), "{}", f.app);
    assert_eq!(h.link_of(pid).await.as_deref(), Some(first.as_str()), "the first link stands");
    assert_eq!(h.links_of_sub(&second).await, 0);
}

#[tokio::test]
async fn inactive_accounts_are_refused_and_redeem_rechecks_the_status() {
    let h = setup_or_skip!();
    // Linked, then suspended.
    let local = format!("821{}", fresh_local());
    let s = sub();
    let r = h.login(who(&s, &format!("0{local}"), true)).await;
    let pid: i64 = r["user"]["id"].as_str().unwrap().parse().unwrap();
    h.set_status(pid, "suspended").await;
    let f = h.sign_in(who(&s, &format!("0{local}"), true), "/").await;
    assert_eq!(f.error().as_deref(), Some("inactive"), "{}", f.app);

    // A pending account matched by a verified phone.
    let local = format!("822{}", fresh_local());
    let pending = h.seed_account(&format!("0{local}"), "Pending").await;
    h.set_status(pending, "pending").await;
    let f = h.sign_in(who(&sub(), &format!("0{local}"), true), "/").await;
    assert_eq!(f.error().as_deref(), Some("inactive"), "{}", f.app);

    // Active at the callback, suspended before the page redeems.
    let local = format!("823{}", fresh_local());
    let s = sub();
    h.login(who(&s, &format!("0{local}"), true)).await;
    let f = h.sign_in(who(&s, &format!("0{local}"), true), "/").await;
    let pid = h.pids_with_local(&local).await[0];
    h.set_status(pid, "suspended").await;
    let r = h.redeem(&f.code(), Some(&f.browser_cookies())).await;
    assert_eq!(r.body["code"], "failed_precondition", "issue_login re-checks at redeem: {}", r.body);
    assert!(r.body.get("token").is_none());
}

#[tokio::test]
async fn the_state_must_be_ours_fresh_unused_and_this_browsers() {
    let h = setup_or_skip!();
    let local = format!("824{}", fresh_local());
    h.next(who(&sub(), &format!("0{local}"), true));
    let err = |r: &Resp| query_of(&r.location).get("error").cloned();

    // No cookie, a wrong cookie, another browser's state.
    let s = h.start("/").await;
    let back = portal_redirect(&s.location).await;
    let r = h.callback(&back, None).await;
    assert_eq!(err(&r).as_deref(), Some("expired"), "no cookie: {}", r.location);
    let s = h.start("/").await;
    let back = portal_redirect(&s.location).await;
    let r = h.callback(&back, Some("sedjiwa_sso_state=somebody-else")).await;
    assert_eq!(err(&r).as_deref(), Some("expired"), "wrong cookie");
    let mine = h.start("/").await;
    let theirs = h.start("/").await;
    let back = portal_redirect(&theirs.location).await;
    let r = h.callback(&back, Some(&cookie_header(&mine.set_cookies))).await;
    assert_eq!(err(&r).as_deref(), Some("expired"), "a state started in another browser");

    // Unknown state, no state.
    let r = h.callback("x?code=abc&state=never-issued", Some("sedjiwa_sso_state=never-issued")).await;
    assert_eq!(err(&r).as_deref(), Some("expired"));
    let r = h.callback("x?code=abc", None).await;
    assert_eq!(err(&r).as_deref(), Some("expired"));

    // A state finishes once.
    let s = h.start("/").await;
    let back = portal_redirect(&s.location).await;
    let ck = cookie_header(&s.set_cookies);
    let ok = h.callback(&back, Some(&ck)).await;
    assert!(query_of(&ok.location).contains_key("code"), "{}", ok.location);
    let replay = h.callback(&back, Some(&ck)).await;
    assert_eq!(err(&replay).as_deref(), Some("expired"), "replayed callback");

    assert_eq!(h.pids_with_local(&local).await.len(), 1, "only the finished sign-in made an account");
}

#[tokio::test]
async fn portal_and_token_failures_are_reported_and_sign_no_one_in() {
    let h = setup_or_skip!();
    let local = format!("825{}", fresh_local());
    for (mode, want) in [
        ("deny", "denied"),
        ("bad_sig", "provider"),
        ("bad_nonce", "provider"),
        ("wrong_iss", "provider"),
        ("wrong_aud", "provider"),
        ("expired", "provider"),
        ("no_id_token", "provider"),
        ("userinfo_other_sub", "provider"),
    ] {
        let mut w = who(&sub(), &format!("0{local}"), true);
        w["mode"] = json!(mode);
        let f = h.sign_in(w, "/").await;
        assert_eq!(f.error().as_deref(), Some(want), "{mode}: {}", f.app);
        assert!(!f.app.contains("code="), "{mode}: no code");
    }
    assert!(h.pids_with_local(&local).await.is_empty(), "no account was made by a failed sign-in");

    // A portal callback with no code and no error.
    let s = h.start("/").await;
    let state = query_of(&s.location)["state"].clone();
    let r = h.callback(&format!("x?state={state}"), Some(&cookie_header(&s.set_cookies))).await;
    assert_eq!(query_of(&r.location).get("error").map(String::as_str), Some("denied"));
}

#[tokio::test]
async fn a_rotated_portal_key_is_fetched_once() {
    let h = setup_or_skip!();
    let local = format!("826{}", fresh_local());
    let s = sub();
    h.login(who(&s, &format!("0{local}"), true)).await;
    let before = h.idp.lock().unwrap().jwks_fetches;
    assert_eq!(before, 1, "keys are cached after the first sign-in");
    let mut w = who(&s, &format!("0{local}"), true);
    w["mode"] = json!("rotated");
    h.login(w.clone()).await;
    assert_eq!(h.idp.lock().unwrap().jwks_fetches, 2, "an unknown kid refetches the keys once");
    h.login(w).await;
    assert_eq!(h.idp.lock().unwrap().jwks_fetches, 2, "and the new key is cached");
}

/// Whether `r`, followed by a browser from https://pm.example/, stays there.
fn stays_on_site(r: &str) -> bool {
    let base = reqwest::Url::parse("https://pm.example/sso/callback").unwrap();
    base.join(r).map(|u| u.host_str() == Some("pm.example")).unwrap_or(false)
}

#[tokio::test]
async fn the_redirect_never_leaves_the_site() {
    let h = setup_or_skip!();
    let local = format!("827{}", fresh_local());
    let s = sub();
    for (asked, want) in [
        ("/projects/1?x=2#top", "/projects/1?x=2#top"),
        ("//evil.example", "/"),
        ("https://evil.example", "/"),
        ("/\\evil.example", "/"),
        ("\\\\evil.example", "/"),
        ("evil.example", "/"),
        ("", "/"),
    ] {
        let f = h.sign_in(who(&s, &format!("0{local}"), true), asked).await;
        assert_eq!(f.q()["redirect"], want, "asked {asked:?}");
    }
}

#[tokio::test]
async fn the_redirect_guard_survives_browser_url_cleanup() {
    let h = setup_or_skip!();
    let local = format!("828{}", fresh_local());
    let s = sub();
    // Browsers drop tabs and newlines from URLs: "/\t/evil" is "//evil".
    for asked in ["/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/\t\\evil.example"] {
        let f = h.sign_in(who(&s, &format!("0{local}"), true), asked).await;
        let got = f.q()["redirect"].clone();
        assert!(stays_on_site(&got), "asked {asked:?}, got {got:?}, which a browser follows off-site");
    }
}

#[tokio::test]
async fn only_the_browser_that_signed_in_can_redeem_the_code() {
    let h = setup_or_skip!();
    let local = format!("829{}", fresh_local());
    // The attacker signs in as themselves and stops at the app link…
    let f = h.sign_in(who(&sub(), &format!("0{local}"), true), "/").await;
    let code = f.code();
    let bind = f.app_cookies.iter().find(|c| c.starts_with("sedjiwa_sso_code=")).expect("the callback binds the code to this browser");
    for attr in ["HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=60"] {
        assert!(bind.contains(attr), "{attr} in {bind}");
    }
    // …and gets a victim's browser (no cookies from this flow, or its own) to open it.
    for cookie in [None, Some("sedjiwa_sso_code=forged"), Some("sedjiwa_sso_state=x; other=1")] {
        let r = h.redeem(&code, cookie).await;
        assert_eq!(r.body["code"], "unauthenticated", "cookie {cookie:?}: a foreign browser was signed in as the attacker: {}", r.body);
        assert!(r.body.get("token").is_none());
    }
    // Another sign-in's binding does not unlock this code either.
    let g = h.sign_in(who(&sub(), &format!("0{local}9"), true), "/").await;
    let r = h.redeem(&code, Some(&g.browser_cookies())).await;
    assert_eq!(r.body["code"], "unauthenticated", "a different browser's binding: {}", r.body);
    // The real browser still can.
    let r = h.redeem(&code, Some(&f.browser_cookies())).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.body);
}

#[tokio::test]
async fn deleting_a_user_removes_the_link() {
    let h = setup_or_skip!();
    let local = format!("830{}", fresh_local());
    let s = sub();
    let r = h.login(who(&s, &format!("0{local}"), true)).await;
    let pid: i64 = r["user"]["id"].as_str().unwrap().parse().unwrap();
    assert_eq!(h.links_of_sub(&s).await, 1);
    sqlx::query("DELETE FROM arke_entities WHERE pid = $1").bind(pid).execute(h.store.pool()).await.unwrap();
    assert_eq!(h.links_of_sub(&s).await, 0, "the link went with the user");
    // The same portal account signs in again as a fresh account.
    let r = h.login(who(&s, &format!("0{local}"), true)).await;
    assert_ne!(r["user"]["id"], pid.to_string().as_str());
}

#[tokio::test]
async fn two_first_sign_ins_at_once_make_one_account() {
    let h = setup_or_skip!();
    let local = format!("831{}", fresh_local());
    let s = sub();
    h.next(who(&s, &format!("0{local}"), true));
    let (a, b) = tokio::join!(h.start("/"), h.start("/"));
    let (ba, bb) = tokio::join!(portal_redirect(&a.location), portal_redirect(&b.location));
    let (ca, cb) = (cookie_header(&a.set_cookies), cookie_header(&b.set_cookies));
    let (ra, rb) = tokio::join!(h.callback(&ba, Some(&ca)), h.callback(&bb, Some(&cb)));
    let pids = h.pids_with_local(&local).await;
    assert_eq!(pids.len(), 1, "one account: {} / {}", ra.location, rb.location);
    assert_eq!(h.links_of_sub(&s).await, 1, "one link");
    let codes = [&ra, &rb].iter().filter(|r| query_of(&r.location).contains_key("code")).count();
    assert!(codes >= 1, "at least one sign-in finished: {} / {}", ra.location, rb.location);
}

#[tokio::test]
async fn an_unverified_phone_nobody_has_creates_nothing() {
    let h = setup_or_skip!();
    let local = format!("832{}", fresh_local());
    let s = sub();
    for w in [
        who(&s, &format!("0{local}"), false),
        json!({ "sub": s, "name": "No Flag", "phone_number": format!("+62{local}") }),
        json!({ "sub": s, "phone_number": format!("0{local}"), "phone_number_verified": null }),
    ] {
        let f = h.sign_in(w.clone(), "/").await;
        assert_eq!(f.error().as_deref(), Some("verify_phone"), "{w}: {}", f.app);
        assert!(!f.app.contains("code="), "no code");
    }
    assert!(h.pids_with_local(&local).await.is_empty(), "no account was created");
    assert_eq!(h.links_of_sub(&s).await, 0, "no link was made");

    // Once the portal has verified it, the same person gets in.
    let r = h.login(who(&s, &format!("0{local}"), true)).await;
    assert_eq!(r["user"]["phone"], format!("0{local}").as_str());
    assert_eq!(h.links_of_sub(&s).await, 1);
}

#[tokio::test]
async fn a_linked_account_signs_in_even_if_the_portal_unverifies_the_phone() {
    let h = setup_or_skip!();
    let local = format!("833{}", fresh_local());
    let s = sub();
    let first = h.login(who(&s, &format!("0{local}"), true)).await;
    let again = h.login(who(&s, &format!("0{local}"), false)).await;
    assert_eq!(again["user"]["id"], first["user"]["id"], "the link decides, not the phone");
    // Even with the phone gone or changed on the portal side.
    let again = h.login(json!({ "sub": s })).await;
    assert_eq!(again["user"]["id"], first["user"]["id"]);
    assert_eq!(h.pids_with_local(&local).await.len(), 1);
}
