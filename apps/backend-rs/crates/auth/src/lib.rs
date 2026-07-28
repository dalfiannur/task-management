//! Auth: JWT verification and AuthUser context.

use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};

/// JWT claims. MUST match the shape signed by the current Bun backend
/// (`apps/backend/src/auth/jwt.ts`): `sub` = user id, optional `permissions`.
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    pub exp: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AuthUser {
    pub id: String,
    pub permissions: Vec<String>,
}

impl AuthUser {
    pub fn is_admin(&self) -> bool {
        self.permissions.iter().any(|p| p == "*")
    }
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum AuthError {
    #[error("invalid or expired token")]
    Invalid,
}

pub fn verify_jwt(token: &str, secret: &str) -> Result<AuthUser, AuthError> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )
    .map_err(|_| AuthError::Invalid)?;
    Ok(AuthUser {
        id: data.claims.sub,
        permissions: data.claims.permissions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{encode, EncodingKey, Header};

    fn mint(secret: &str, sub: &str, perms: &[&str], exp: usize) -> String {
        let claims = Claims {
            sub: sub.into(),
            permissions: perms.iter().map(|s| s.to_string()).collect(),
            exp,
        };
        encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(secret.as_bytes()),
        )
        .unwrap()
    }

    #[test]
    fn valid_token_yields_user() {
        let t = mint("s3cret", "user-1", &["*"], 9_999_999_999);
        let u = verify_jwt(&t, "s3cret").unwrap();
        assert_eq!(u.id, "user-1");
        assert!(u.is_admin());
    }

    #[test]
    fn wrong_secret_rejected() {
        let t = mint("s3cret", "user-1", &[], 9_999_999_999);
        assert_eq!(verify_jwt(&t, "other"), Err(AuthError::Invalid));
    }

    #[test]
    fn expired_token_rejected() {
        let t = mint("s3cret", "user-1", &[], 1); // 1970
        assert_eq!(verify_jwt(&t, "s3cret"), Err(AuthError::Invalid));
    }
}
