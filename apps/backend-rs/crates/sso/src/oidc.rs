//! The OIDC client side: discovery, the portal's signing keys, the code
//! exchange (client secret + PKCE) and ID token verification. Discovery and
//! keys are fetched on first use and cached; keys are fetched again when a
//! token names a key we have not seen (the portal rotated them).

use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::sync::RwLock;

use crate::config::SsoConfig;

#[derive(Debug, Clone, Deserialize)]
pub struct Metadata {
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub jwks_uri: String,
    pub userinfo_endpoint: Option<String>,
}

/// Who the portal says signed in. Phone and name may come from the ID token
/// or from userinfo; userinfo wins where both have a value.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Identity {
    pub sub: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub phone_number: Option<String>,
    #[serde(default)]
    pub phone_number_verified: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct IdClaims {
    #[serde(flatten)]
    identity: Identity,
    #[serde(default)]
    nonce: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    id_token: Option<String>,
}

pub struct Client {
    cfg: SsoConfig,
    http: reqwest::Client,
    meta: RwLock<Option<Metadata>>,
    keys: RwLock<Option<JwkSet>>,
}

/// URL-safe random string of `n` random bytes.
pub fn random_token(n: usize) -> String {
    let mut b = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut b);
    URL_SAFE_NO_PAD.encode(b)
}

/// PKCE S256: base64url(sha256(verifier)).
pub fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

impl Client {
    pub fn new(cfg: SsoConfig) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("http client");
        Client { cfg, http, meta: RwLock::new(None), keys: RwLock::new(None) }
    }

    pub fn config(&self) -> &SsoConfig {
        &self.cfg
    }

    pub async fn metadata(&self) -> anyhow::Result<Metadata> {
        if let Some(m) = self.meta.read().await.clone() {
            return Ok(m);
        }
        let url = format!("{}/.well-known/openid-configuration", self.cfg.issuer);
        let m: Metadata = self.http.get(&url).send().await?.error_for_status()?.json().await?;
        // A discovery document for a different issuer is someone else's.
        if m.issuer.trim_end_matches('/') != self.cfg.issuer {
            anyhow::bail!("discovery issuer {} is not the configured {}", m.issuer, self.cfg.issuer);
        }
        *self.meta.write().await = Some(m.clone());
        Ok(m)
    }

    pub async fn authorize_url(&self, state: &str, nonce: &str, verifier: &str) -> anyhow::Result<String> {
        let m = self.metadata().await?;
        let mut url = reqwest::Url::parse(&m.authorization_endpoint)?;
        url.query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", &self.cfg.client_id)
            .append_pair("redirect_uri", &self.cfg.redirect_uri)
            .append_pair("scope", "openid profile phone email")
            .append_pair("state", state)
            .append_pair("nonce", nonce)
            .append_pair("code_challenge", &challenge(verifier))
            .append_pair("code_challenge_method", "S256");
        Ok(url.into())
    }

    async fn key_set(&self, refresh: bool) -> anyhow::Result<JwkSet> {
        if !refresh {
            if let Some(k) = self.keys.read().await.clone() {
                return Ok(k);
            }
        }
        let m = self.metadata().await?;
        let k: JwkSet = self.http.get(&m.jwks_uri).send().await?.error_for_status()?.json().await?;
        *self.keys.write().await = Some(k.clone());
        Ok(k)
    }

    /// Exchange the code, verify the ID token (signature, issuer, audience,
    /// expiry, nonce) and merge in userinfo.
    pub async fn finish(&self, code: &str, verifier: &str, nonce: &str) -> anyhow::Result<Identity> {
        let m = self.metadata().await?;
        let tok: TokenResponse = self
            .http
            .post(&m.token_endpoint)
            .form(&[
                ("grant_type", "authorization_code"),
                ("code", code),
                ("redirect_uri", &self.cfg.redirect_uri),
                ("code_verifier", verifier),
                ("client_id", &self.cfg.client_id),
                ("client_secret", &self.cfg.client_secret),
            ])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let id_token = tok.id_token.ok_or_else(|| anyhow::anyhow!("no id_token in the token response"))?;
        let claims = self.verify(&id_token).await?;
        if claims.nonce.as_deref() != Some(nonce) {
            anyhow::bail!("id_token nonce does not match");
        }
        let mut id = claims.identity;
        if let Some(url) = &m.userinfo_endpoint {
            let info: Identity = self
                .http
                .get(url)
                .bearer_auth(&tok.access_token)
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
            if info.sub != id.sub {
                anyhow::bail!("userinfo is for a different subject");
            }
            id.name = info.name.or(id.name);
            id.email = info.email.or(id.email);
            id.phone_number = info.phone_number.or(id.phone_number);
            id.phone_number_verified = info.phone_number_verified.or(id.phone_number_verified);
        }
        Ok(id)
    }

    async fn verify(&self, token: &str) -> anyhow::Result<IdClaims> {
        let header = decode_header(token)?;
        if header.alg != Algorithm::RS256 {
            anyhow::bail!("unexpected id_token algorithm {:?}", header.alg);
        }
        let pick = |set: &JwkSet| match &header.kid {
            Some(kid) => set.find(kid).cloned(),
            None if set.keys.len() == 1 => set.keys.first().cloned(),
            None => None,
        };
        let jwk = match pick(&self.key_set(false).await?) {
            Some(k) => k,
            None => pick(&self.key_set(true).await?)
                .ok_or_else(|| anyhow::anyhow!("no portal key matches the id_token"))?,
        };
        let mut v = Validation::new(Algorithm::RS256);
        v.set_issuer(&[&self.cfg.issuer, &format!("{}/", self.cfg.issuer)]);
        v.set_audience(&[&self.cfg.client_id]);
        v.leeway = 60;
        Ok(decode::<IdClaims>(token, &DecodingKey::from_jwk(&jwk)?, &v)?.claims)
    }
}
