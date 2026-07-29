//! Auth: JWT sign/verify, Argon2id password hashing, and AuthUser context.

use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

mod hash;
pub use hash::{hash_password, verify_password, HashError};

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

    /// True if the user is admin (`*`) or carries the exact `perm`.
    pub fn has(&self, perm: &str) -> bool {
        self.is_admin() || self.permissions.iter().any(|p| p == perm)
    }
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum AuthError {
    #[error("invalid or expired token")]
    Invalid,
}

/// Sign an HS256 JWT: `{ sub, permissions, exp }`. `exp` is absolute unix seconds.
pub fn sign_jwt(
    secret: &str,
    sub: &str,
    permissions: &[String],
    exp: usize,
) -> Result<String, AuthError> {
    let claims = Claims {
        sub: sub.to_string(),
        permissions: permissions.to_vec(),
        exp,
    };
    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|_| AuthError::Invalid)
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

    #[test]
    fn permission_has() {
        let u = AuthUser {
            id: "1".into(),
            permissions: vec!["projects:create".into()],
        };
        assert!(u.has("projects:create"));
        assert!(!u.has("users:admin"));
        let admin = AuthUser {
            id: "2".into(),
            permissions: vec!["*".into()],
        };
        assert!(admin.has("anything"));
    }

    #[test]
    fn sign_then_verify_round_trip() {
        let perms = vec!["projects:create".to_string()];
        let t = sign_jwt("s3cret", "user-9", &perms, 9_999_999_999).unwrap();
        let u = verify_jwt(&t, "s3cret").unwrap();
        assert_eq!(u.id, "user-9");
        assert_eq!(u.permissions, perms);
        assert!(!u.is_admin());
    }
}
