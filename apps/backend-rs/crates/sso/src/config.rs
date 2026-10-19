//! SSO settings, from the environment. All four of SSO_ISSUER,
//! SSO_CLIENT_ID, SSO_CLIENT_SECRET and SSO_REDIRECT_URI turn SSO on; none
//! leaves it off. Some but not all is a mistake: it is logged and SSO stays
//! off, rather than stopping the app.

use std::collections::HashMap;

#[derive(Clone, PartialEq)]
pub struct SsoConfig {
    /// The portal's issuer, e.g. `https://portal.sedjiwa.id` (no trailing `/`).
    pub issuer: String,
    pub client_id: String,
    pub client_secret: String,
    /// Where the portal sends the browser back: this backend's public
    /// `/sso/callback`, e.g. `https://pm.sedjiwa.id/api/tasks-rs/sso/callback`.
    pub redirect_uri: String,
    /// Shown on the sign-in button.
    pub provider_name: String,
}

impl std::fmt::Debug for SsoConfig {
    // Never print the secret.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SsoConfig")
            .field("issuer", &self.issuer)
            .field("client_id", &self.client_id)
            .field("redirect_uri", &self.redirect_uri)
            .field("provider_name", &self.provider_name)
            .finish_non_exhaustive()
    }
}

const REQUIRED: [&str; 4] = ["SSO_ISSUER", "SSO_CLIENT_ID", "SSO_CLIENT_SECRET", "SSO_REDIRECT_URI"];

impl SsoConfig {
    /// `Ok(None)`: SSO off. `Err`: partly configured (names the missing vars).
    pub fn from_map(m: &HashMap<String, String>) -> Result<Option<Self>, String> {
        let get = |k: &str| m.get(k).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        let missing: Vec<&str> = REQUIRED.iter().copied().filter(|k| get(k).is_none()).collect();
        if missing.len() == REQUIRED.len() {
            return Ok(None);
        }
        if !missing.is_empty() {
            return Err(format!("SSO is partly configured; missing {}", missing.join(", ")));
        }
        Ok(Some(SsoConfig {
            issuer: get("SSO_ISSUER").unwrap().trim_end_matches('/').to_string(),
            client_id: get("SSO_CLIENT_ID").unwrap(),
            client_secret: get("SSO_CLIENT_SECRET").unwrap(),
            redirect_uri: get("SSO_REDIRECT_URI").unwrap(),
            provider_name: get("SSO_PROVIDER_NAME").unwrap_or_else(|| "Sedjiwa Portal".into()),
        }))
    }

    pub fn from_env() -> Option<Self> {
        let m = std::env::vars().collect::<HashMap<_, _>>();
        match Self::from_map(&m) {
            Ok(c) => c,
            Err(e) => {
                tracing::error!("{e}; SSO stays off");
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn none_set_is_off_all_set_is_on_some_set_is_an_error() {
        assert_eq!(SsoConfig::from_map(&m(&[])), Ok(None));
        let all = m(&[
            ("SSO_ISSUER", "https://portal.example/"),
            ("SSO_CLIENT_ID", "id"),
            ("SSO_CLIENT_SECRET", "s"),
            ("SSO_REDIRECT_URI", "https://pm.example/api/tasks-rs/sso/callback"),
        ]);
        let c = SsoConfig::from_map(&all).unwrap().unwrap();
        assert_eq!(c.issuer, "https://portal.example");
        assert_eq!(c.provider_name, "Sedjiwa Portal");
        let err = SsoConfig::from_map(&m(&[("SSO_ISSUER", "x"), ("SSO_CLIENT_ID", " ")])).unwrap_err();
        assert!(err.contains("SSO_CLIENT_ID") && err.contains("SSO_CLIENT_SECRET"));
        assert!(!format!("{c:?}").contains("\"s\""));
    }
}
