# Labels Palette Flow — Implementation Plan (backend, per-op Store)

> **For agentic workers:** small `LabelService`. Mirrors pages/modules. Verified against Postgres.

**Goal:** Per-project label palette per [spec](../specs/2026-07-29-labels-palette-flow-design.md): CRUD, member-gated, hex-color validation, tolerant delete (no cascade — tasks keep dangling `label_ids`, frontend filters).

**Decisions:** label id = pid string. "Is a label" = has `LabelInfo`. Name non-empty; color `#RRGGBB` validated (else `INVALID_ARGUMENT`). Names not forced unique. Delete removes only the label entity.

---

## Task 1: domain — label component + rules (TDD)

**Files:** Create `crates/domain/src/label.rs`; modify lib.rs.

- [ ] `LabelInfo{ #[pg(index)] project_id, #[pg(index)] name, color }`. Rules `label_name_ok` (trim non-empty), `color_ok` (`#` + 6 hex). Tests. register_all.

## Task 2: proto — labels.proto

**Files:** `proto/labels.proto` (`package sedjiwa.tasks.label.v1`) per spec §3; build.rs.
- [ ] `cargo build -p transport`.

## Task 3: transport — records + LabelService

**Files:** `crates/transport/src/labels/{mod.rs,record.rs,label_service.rs}`; transport lib.rs.

- [ ] mod.rs: guards (require_auth, require_member).
- [ ] record.rs: LabelRecord + read/to_proto/load_label/labels_for_project (sorted by name, pid).
- [ ] label_service.rs: `list_labels` (member), `create_label` (member; name+color validated), `update_label` (member; patch name/color, validate if present), `delete_label` (member; delete only). `label_router`.

## Task 4: app — wire + integration test + verify

**Files:** router.rs merge; `crates/transport/tests/label_flow.rs`.

- [ ] Merge label_router. Test: member creates (name+color); invalid color/blank name rejected; list member-gated (non-member denied); update patches; delete removes only the label. `cargo test --workspace` (rerun-safe) + clippy. Commit `feat(backend-rs): project Labels palette on per-op Store`. Don't push.
