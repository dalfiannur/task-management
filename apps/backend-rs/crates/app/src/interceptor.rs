use auth::{verify_jwt, AuthUser};

/// Pure helper: turn an optional Authorization header into an AuthUser.
/// `None` header or bad token → None (handlers decide whether that's fatal).
pub fn user_from_header(header: Option<&str>, secret: &str) -> Option<AuthUser> {
    let raw = header?;
    let token = raw
        .strip_prefix("Bearer ")
        .or_else(|| raw.strip_prefix("bearer "))?;
    verify_jwt(token.trim(), secret).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
    use serde::Serialize;

    #[derive(Serialize)]
    struct C {
        sub: String,
        permissions: Vec<String>,
        exp: usize,
    }

    fn bearer(secret: &str, sub: &str) -> String {
        let c = C {
            sub: sub.into(),
            permissions: vec![],
            exp: 9_999_999_999,
        };
        let t = encode(
            &Header::new(Algorithm::HS256),
            &c,
            &EncodingKey::from_secret(secret.as_bytes()),
        )
        .unwrap();
        format!("Bearer {t}")
    }

    #[test]
    fn valid_bearer_extracts_user() {
        let h = bearer("s", "u-7");
        assert_eq!(user_from_header(Some(&h), "s").unwrap().id, "u-7");
    }

    #[test]
    fn missing_header_is_none() {
        assert!(user_from_header(None, "s").is_none());
    }

    #[test]
    fn wrong_secret_is_none() {
        let h = bearer("s", "u-7");
        assert!(user_from_header(Some(&h), "other").is_none());
    }
}
