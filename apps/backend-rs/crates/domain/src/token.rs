//! Personal access token (PAT) untuk endpoint MCP: komponen ECS + aturan murni.
//!
//! Design note: rahasia disimpan sebagai digest **SHA-256, bukan Argon2**. Sebuah
//! PAT membawa entropi 256 bit sehingga tidak brute-force-able seperti password
//! manusia, sementara Argon2 akan menambah ~50-100 ms pada *setiap* tool call MCP.
//! Hashing password tetap di `user::UserPassword`.

use arke_postgres::PgComponent;

/// Awalan setiap token yang kita terbitkan, supaya string yang bocor mudah di-grep.
pub const TOKEN_PREFIX: &str = "sjw_pat_";

/// Rahasia opaque, hanya disimpan sebagai digest. `preview` adalah 4 karakter
/// terakhir plaintext — satu-satunya bagian yang boleh ditampilkan lagi oleh UI.
#[derive(PgComponent, Debug, Clone)]
pub struct TokenSecret {
    #[pg(index, unique)]
    pub hash: String,
    pub preview: String,
}

/// Pemilik token. Diindeks karena setiap pembacaan daftar difilter dengannya.
#[derive(PgComponent, Debug, Clone)]
pub struct TokenOwner {
    #[pg(index)]
    pub user_id: String,
}

#[derive(PgComponent, Debug, Clone)]
pub struct TokenInfo {
    pub name: String,
    pub created_at: String,
    /// RFC3339. `None` = tidak pernah kedaluwarsa (`expires_in_days = 0`).
    pub expires_at: Option<String>,
}

#[derive(PgComponent, Debug, Clone)]
pub struct TokenUsage {
    pub last_used_at: Option<String>,
}

fn to_hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    })
}

/// Terbitkan token baru: `sjw_pat_` + 32 byte acak dalam hex.
pub fn generate_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!("{TOKEN_PREFIX}{}", to_hex(&bytes))
}

/// Digest yang disimpan. Deterministik — pencarian token adalah lookup by hash.
pub fn hash_token(token: &str) -> String {
    use sha2::{Digest, Sha256};
    to_hex(&Sha256::digest(token.as_bytes()))
}

/// 4 karakter terakhir — satu-satunya sisa plaintext yang boleh dilihat lagi.
pub fn preview_of(token: &str) -> String {
    let n = token.chars().count();
    token.chars().skip(n.saturating_sub(4)).collect()
}

/// Bentuknya mustahil diterbitkan oleh kita → tolak input yang jelas bukan
/// token sebelum sempat menghitung hash dan melakukan round-trip ke database.
///
/// `hash_token` aman dipakai membangun predikat SQL bukan karena gate ini:
/// keluarannya selalu digest hex 64 karakter untuk input apa pun, jadi aman
/// secara struktural dengan sendirinya. Tujuan gate ini berbeda dan tetap
/// berlaku sendiri — menolak input yang jelas salah bentuk lebih awal.
pub fn looks_like_token(s: &str) -> bool {
    s.len() == TOKEN_PREFIX.len() + 64
        && s.starts_with(TOKEN_PREFIX)
        && s[TOKEN_PREFIX.len()..].bytes().all(|b| b.is_ascii_hexdigit())
}

/// Sudah lewat `expires_at`? `None` = tanpa kedaluwarsa.
///
/// Membandingkan string RFC3339 UTC secara leksikografis. Urutan leksikal ini
/// SAMA dengan urutan waktu hanya jika kedua sisi diformat pada presisi tetap
/// yang sama: RFC3339 dari crate `time` membuang bagian pecahan detik saat nol
/// dan memangkas nol di belakang saat tidak, sehingga lebar stringnya
/// berubah-ubah dan bisa membalik urutan leksikal dalam detik yang sama
/// (mis. "...T10:00:00Z" > "...T10:00:00.5Z" secara leksikal, padahal
/// 10:00:00.0 lebih awal dari 10:00:00.5). Karena itu pemanggil mem-pin
/// timestamp ke detik bulat (`replace_nanosecond(0)`) sebelum memformat,
/// supaya prasyarat presisi-sama ini benar-benar terpenuhi. `task::dates_ok`
/// membandingkan tanggal `YYYY-MM-DD` polos tanpa jam dan tanpa komponen
/// lebar-variabel, jadi analoginya lebih lemah — kasus ini tidak muncul di sana.
pub fn is_expired(expires_at: Option<&str>, now: &str) -> bool {
    match expires_at {
        None => false,
        Some(e) => e <= now,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_token_has_prefix_and_fixed_length() {
        let t = generate_token();
        assert!(t.starts_with(TOKEN_PREFIX));
        assert_eq!(t.len(), TOKEN_PREFIX.len() + 64);
        assert!(looks_like_token(&t));
    }

    #[test]
    fn two_tokens_differ() {
        assert_ne!(generate_token(), generate_token());
    }

    #[test]
    fn hash_is_stable_and_not_the_plaintext() {
        let t = generate_token();
        let h = hash_token(&t);
        assert_eq!(h, hash_token(&t));
        assert_eq!(h.len(), 64);
        assert!(!h.contains(&t));
    }

    #[test]
    fn preview_is_last_four_chars() {
        assert_eq!(preview_of("sjw_pat_00ff1a2b"), "1a2b");
        assert_eq!(preview_of("ab"), "ab"); // lebih pendek dari 4 → apa adanya
    }

    #[test]
    fn garbage_is_not_a_token() {
        assert!(!looks_like_token("hello"));
        assert!(!looks_like_token(&"sjw_pat_".repeat(9)));
        // Benar panjangnya, tapi ada karakter non-hex.
        let bad = format!("{TOKEN_PREFIX}{}", "z".repeat(64));
        assert!(!looks_like_token(&bad));
    }

    #[test]
    fn expiry_compares_lexicographically() {
        assert!(!is_expired(None, "2026-09-02T00:00:00Z"));
        assert!(is_expired(
            Some("2026-09-01T00:00:00Z"),
            "2026-09-02T00:00:00Z"
        ));
        assert!(!is_expired(
            Some("2026-09-03T00:00:00Z"),
            "2026-09-02T00:00:00Z"
        ));
    }
}
