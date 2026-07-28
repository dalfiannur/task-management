use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub jwt_expires_in: String,
    pub port: u16,
    pub cors_origins: Vec<String>,
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum ConfigError {
    #[error("missing required env var: {0}")]
    Missing(&'static str),
}

impl Config {
    /// Build from a key→value map (pure; env adapter lives in `from_env`).
    pub fn from_map(m: &HashMap<String, String>) -> Result<Self, ConfigError> {
        let get = |k: &'static str| m.get(k).cloned();
        Ok(Config {
            database_url: get("DATABASE_URL").ok_or(ConfigError::Missing("DATABASE_URL"))?,
            jwt_secret: get("AUTH_JWT_SECRET").ok_or(ConfigError::Missing("AUTH_JWT_SECRET"))?,
            jwt_expires_in: get("AUTH_JWT_EXPIRES_IN").unwrap_or_else(|| "7d".into()),
            port: get("PORT").and_then(|p| p.parse().ok()).unwrap_or(3010),
            cors_origins: get("CORS_ORIGINS")
                .unwrap_or_else(|| "http://localhost:3001".into())
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
        })
    }

    pub fn from_env() -> Result<Self, ConfigError> {
        let m = std::env::vars().collect::<HashMap<_, _>>();
        Self::from_map(&m)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> HashMap<String, String> {
        HashMap::from([
            ("DATABASE_URL".into(), "postgres://x".into()),
            ("AUTH_JWT_SECRET".into(), "s".into()),
        ])
    }

    #[test]
    fn defaults_apply() {
        let c = Config::from_map(&base()).unwrap();
        assert_eq!(c.port, 3010);
        assert_eq!(c.jwt_expires_in, "7d");
        assert_eq!(c.cors_origins, vec!["http://localhost:3001".to_string()]);
    }

    #[test]
    fn missing_secret_errors() {
        let mut m = base();
        m.remove("AUTH_JWT_SECRET");
        assert_eq!(
            Config::from_map(&m),
            Err(ConfigError::Missing("AUTH_JWT_SECRET"))
        );
    }

    #[test]
    fn cors_splits_and_trims() {
        let mut m = base();
        m.insert("CORS_ORIGINS".into(), "a , b ,".into());
        assert_eq!(Config::from_map(&m).unwrap().cors_origins, vec!["a", "b"]);
    }
}
