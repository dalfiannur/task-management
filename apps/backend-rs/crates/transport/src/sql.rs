//! Penjaga untuk nilai yang ikut masuk ke predikat SQL `Store::query`.
//!
//! `predicate` milik `Store::query` adalah SQL mentah yang dipercaya, bukan
//! parameter terikat. Setiap id yang berasal dari luar harus lewat gerbang ini
//! sebelum diinterpolasi.

/// Id yang aman diinterpolasi: tidak kosong, maksimal 64 karakter, dan hanya
/// alfanumerik ASCII, `_`, atau `-`.
pub(crate) fn safe_sql_id(v: &str) -> bool {
    !v.is_empty()
        && v.len() <= 64
        && v.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
