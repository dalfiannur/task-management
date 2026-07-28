//! Transport: generated Connect types + HealthService handlers.
//!
//! The generated module tree (from `proto/health.proto`) is included below;
//! health types live at `crate::sedjiwa::tasks::health::v1`.
//!
//! NOTE (Task 7 blocker): `arke::World` is `!Send`, so a shared `Store` cannot be
//! held as axum state nor across `.await` in a Send handler future. The handlers +
//! router are added once the Store's threading model is decided (actor pattern).

include!(concat!(env!("OUT_DIR"), "/generated.rs"));
