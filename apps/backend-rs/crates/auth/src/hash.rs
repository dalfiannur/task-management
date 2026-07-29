//! Password hashing — Argon2id with a random per-password salt (PHC string).

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::password_hash::rand_core::OsRng;
use argon2::Argon2;

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum HashError {
    #[error("failed to hash password")]
    Hash,
}

/// Hash `pw` with Argon2id (default params) and a fresh random salt → PHC string.
pub fn hash_password(pw: &str) -> Result<String, HashError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(pw.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|_| HashError::Hash)
}

/// Verify `pw` against a stored PHC hash. Any parse/verify failure → `false`
/// (never leak the reason).
pub fn verify_password(pw: &str, phc: &str) -> bool {
    match PasswordHash::new(phc) {
        Ok(parsed) => Argon2::default()
            .verify_password(pw.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_then_verify() {
        let phc = hash_password("correct horse").unwrap();
        assert!(verify_password("correct horse", &phc));
        assert!(!verify_password("wrong horse", &phc));
    }

    #[test]
    fn salt_makes_hashes_differ() {
        let a = hash_password("same").unwrap();
        let b = hash_password("same").unwrap();
        assert_ne!(a, b, "random salt → distinct PHC strings");
        assert!(verify_password("same", &a) && verify_password("same", &b));
    }

    #[test]
    fn garbage_phc_verifies_false() {
        assert!(!verify_password("x", "not-a-phc-string"));
    }
}
