//! Guard for values that go into a `Store::query` SQL predicate.
//!
//! `Store::query`'s `predicate` is trusted raw SQL, not a bound parameter. Every
//! id that originates outside this crate must pass through this gate before
//! being interpolated.

/// An id safe to interpolate: non-empty, at most 64 characters, and only ASCII
/// alphanumerics, `_`, or `-`.
pub(crate) fn safe_sql_id(v: &str) -> bool {
    !v.is_empty()
        && v.len() <= 64
        && v.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
