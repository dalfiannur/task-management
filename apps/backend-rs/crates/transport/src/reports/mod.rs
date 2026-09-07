//! Periodic reports: cross-project aggregation over a caller-supplied window.
//! See docs/superpowers/specs/2026-09-07-periodic-reports-design.md.
//! No new entities; scope is the dashboard's (member projects, admin: all).

pub(crate) mod window;
