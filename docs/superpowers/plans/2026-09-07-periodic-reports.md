# Periodic Reports (Weekly / Monthly) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cross-project weekly/monthly report page — throughput against the
previous period, per-project and per-member tables, completed/overdue lists, a
counted activity summary — computed on demand and printable to PDF.

**Architecture:** A new read-only `ReportService` in `backend-rs` reuses the
dashboard's `Context` (member scope + all tasks + name maps) so the two surfaces
cannot disagree about what "done" means. The client sends explicit RFC3339 window
instants, so calendar arithmetic and the viewer's timezone stay in the browser
and the server only filters ranges. Activity is counted through indexed `COUNT`s,
never hydrated.

**Tech Stack:** Rust (axum + connectrpc-axum + prost, `time` crate), Postgres via
`persistence::Store`; React 19 + TanStack Router/Query + connect-query + Jotai +
Tailwind v4 on the frontend.

**Spec:** `docs/superpowers/specs/2026-09-07-periodic-reports-design.md`

## Global Constraints

- **Cancelled tasks count nowhere**, in any section. This mirrors
  `Tally::add` in `crates/transport/src/dashboard/context.rs`.
- **Window comparison rule:** truncate the *boundary* to 19 characters
  (`YYYY-MM-DDTHH:MM:SS` — drop the fraction and the `Z`); compare the *stored*
  value unmodified, `>=` for the lower bound and `<` for the upper. Never
  transform the stored column: it must stay index-usable.
- **`completed` and `created` are of the window. `still_open` and `overdue` are
  of *now*.** `overdue` keeps the existing rule: still open and
  `due_date < today()` (UTC).
- **SQL predicates are raw, not bound.** Anything interpolated must be either a
  `&'static str`, an `i64` that parsed, or a `Window` boundary that passed
  `Window::parse`. See `crates/transport/src/sql.rs`.
- **Frontend has no test framework.** Gates are `bun run tsc --noEmit`,
  `bun run lint`, `vite build`. Do not add a test runner.
- **Design tokens are locked.** Only layer-2 semantic tokens
  (`bg-surface-raised`, `text-text-muted`, `shadow-2`, …). No raw hex, no
  `text-[13px]`. Read the header comments in `src/styles/tokens.css` and
  `src/features/auth/components/app-shell.tsx` before styling.
- **Backend tests skip silently** when `DATABASE_URL` is unset, and the first run
  against a fresh database always fails once. Every test step below requires
  confirming the test actually *ran*.

---

### Task 1: The report window

Pure logic, no database, no proto. This is where the comparison rule lives.

**Files:**
- Create: `apps/backend-rs/crates/transport/src/reports/mod.rs`
- Create: `apps/backend-rs/crates/transport/src/reports/window.rs`
- Modify: `apps/backend-rs/crates/transport/src/lib.rs` (add `mod reports;` to the
  module list at lines 19–32, alphabetically after `mod projects;`)

**Interfaces:**
- Consumes: nothing.
- Produces: `crate::reports::window::Window` with
  `Window::parse(start: &str, end: &str) -> Option<Window>`,
  `Window::contains(&self, ts: &str) -> bool`,
  `Window::contains_opt(&self, ts: Option<&String>) -> bool`,
  `Window::start(&self) -> &str`, `Window::end(&self) -> &str`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend-rs/crates/transport/src/reports/window.rs` containing only
the test module for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const START: &str = "2026-09-07T00:00:00.000Z";
    const END: &str = "2026-09-14T00:00:00.000Z";

    fn w() -> Window {
        Window::parse(START, END).expect("valid window")
    }

    #[test]
    fn boundary_start_is_inclusive_end_is_exclusive() {
        let w = w();
        assert!(w.contains("2026-09-07T00:00:00Z"), "exactly start is in");
        assert!(!w.contains("2026-09-14T00:00:00Z"), "exactly end is out");
        assert!(w.contains("2026-09-13T23:59:59Z"), "last second is in");
        assert!(!w.contains("2026-09-06T23:59:59Z"), "before start is out");
    }

    #[test]
    fn fractional_and_plain_seconds_classify_identically() {
        let w = w();
        // transport::now_iso() does not pin nanoseconds, so both forms occur.
        assert!(w.contains("2026-09-07T00:00:00.000000001Z"));
        assert!(w.contains("2026-09-07T00:00:00Z"));
        assert!(!w.contains("2026-09-14T00:00:00.000000001Z"));
        assert!(!w.contains("2026-09-14T00:00:00Z"));
    }

    #[test]
    fn contains_opt_treats_absent_as_outside() {
        let w = w();
        assert!(!w.contains_opt(None));
        assert!(w.contains_opt(Some(&"2026-09-08T12:00:00Z".to_string())));
    }

    #[test]
    fn boundaries_are_truncated_to_seconds_and_normalised() {
        let w = Window::parse("2026-09-07t00:00:00.5Z", END).unwrap();
        assert_eq!(w.start(), "2026-09-07T00:00:00", "lowercase t normalised");
        assert_eq!(w.end(), "2026-09-14T00:00:00");
    }

    #[test]
    fn malformed_or_inverted_windows_are_rejected() {
        assert!(Window::parse("", END).is_none());
        assert!(Window::parse("2026-09-07", END).is_none(), "too short");
        assert!(Window::parse("2026-09-07X00:00:00Z", END).is_none(), "bad sep");
        assert!(Window::parse("20xx-09-07T00:00:00Z", END).is_none(), "not digits");
        assert!(Window::parse(END, START).is_none(), "end before start");
        assert!(Window::parse(START, START).is_none(), "empty window");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend-rs && cargo test -p transport --lib reports::window`
Expected: FAIL — the compiler cannot find `Window` (and `mod reports;` does not
exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `apps/backend-rs/crates/transport/src/reports/mod.rs`:

```rust
//! Periodic reports: cross-project aggregation over a caller-supplied window.
//! See docs/superpowers/specs/2026-09-07-periodic-reports-design.md.
//! No new entities; scope is the dashboard's (member projects, admin: all).

pub(crate) mod window;
```

Put this above the test module in `window.rs`:

```rust
//! The report's time window.
//!
//! Stored timestamps are inconsistent in width: `transport::now_iso()` formats
//! RFC3339 *without* pinning nanoseconds, so `created_at` may be
//! `…T10:23:45Z` or `…T10:23:45.123456789Z`. Compared lexicographically, `.`
//! (0x2E) sorts below `Z` (0x5A), so a fractional value can land on the wrong
//! side of a non-fractional boundary.
//!
//! The fix is to truncate the *boundary* to `YYYY-MM-DDTHH:MM:SS` and leave the
//! stored value alone. Every stored form then orders correctly: a fractional
//! value shares the 19-character prefix and is longer, so it sorts above the
//! boundary — correct, being later within that second; a plain value ends in
//! `Z`, also above; a value in another second differs before character 19. The
//! result is exact at second precision on both bounds, and — because the stored
//! column is never transformed — it stays usable by the `created_at` index.

/// A half-open window `[start, end)`. Both bounds are 19-character
/// `YYYY-MM-DDTHH:MM:SS` strings, safe to interpolate into a SQL predicate
/// because [`Window::parse`] admits nothing but digits and fixed separators.
#[derive(Debug, Clone)]
pub(crate) struct Window {
    start: String,
    end: String,
}

/// `YYYY-MM-DDTHH:MM:SS` from an RFC3339 instant, or `None` if `s` is not one.
/// The `T` is normalised to upper case: RFC3339 permits a lowercase `t`, and a
/// boundary carrying one would never compare equal to stored values that use
/// `T`.
fn truncate(s: &str) -> Option<String> {
    let b = s.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let digit = |i: usize| b[i].is_ascii_digit();
    let shaped = digit(0)
        && digit(1)
        && digit(2)
        && digit(3)
        && b[4] == b'-'
        && digit(5)
        && digit(6)
        && b[7] == b'-'
        && digit(8)
        && digit(9)
        && (b[10] == b'T' || b[10] == b't')
        && digit(11)
        && digit(12)
        && b[13] == b':'
        && digit(14)
        && digit(15)
        && b[16] == b':'
        && digit(17)
        && digit(18);
    if !shaped {
        return None;
    }
    let mut out = s[..19].to_string();
    out.replace_range(10..11, "T");
    Some(out)
}

impl Window {
    /// `None` for a malformed instant, or for a window that is empty or
    /// inverted — those are caller errors and must surface as
    /// `invalid_argument`, never as an empty report.
    pub(crate) fn parse(start: &str, end: &str) -> Option<Self> {
        let (start, end) = (truncate(start)?, truncate(end)?);
        if start >= end {
            return None;
        }
        Some(Self { start, end })
    }

    pub(crate) fn start(&self) -> &str {
        &self.start
    }

    pub(crate) fn end(&self) -> &str {
        &self.end
    }

    /// Is a stored RFC3339 timestamp inside `[start, end)`?
    pub(crate) fn contains(&self, ts: &str) -> bool {
        ts >= self.start.as_str() && ts < self.end.as_str()
    }

    /// Absent (`completed_at` on an unfinished task) is outside every window.
    pub(crate) fn contains_opt(&self, ts: Option<&String>) -> bool {
        ts.is_some_and(|t| self.contains(t))
    }
}
```

Add `mod reports;` to `apps/backend-rs/crates/transport/src/lib.rs`, in the
alphabetical module list, between `mod projects;` and `mod search;`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend-rs && cargo test -p transport --lib reports::window`
Expected: PASS, 5 tests. Also run `cargo clippy -p transport` and expect no new
warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/crates/transport/src/reports apps/backend-rs/crates/transport/src/lib.rs
git commit -m "feat(reports): report window with second-precision boundary rule"
```

---

### Task 2: The proto contract and an empty wired endpoint

Gets the wire working end to end before any aggregation exists, so later tasks
fail for aggregation reasons only.

**Files:**
- Create: `apps/backend-rs/proto/reports.proto`
- Create: `apps/backend-rs/crates/transport/src/reports/report_service.rs`
- Create: `apps/backend-rs/crates/transport/tests/reports_flow.rs`
- Modify: `apps/backend-rs/crates/transport/build.rs` (both lists)
- Modify: `apps/backend-rs/crates/transport/src/reports/mod.rs`
- Modify: `apps/backend-rs/crates/transport/src/lib.rs` (the `pub use` block)
- Modify: `apps/backend-rs/crates/app/src/router.rs:53`

**Interfaces:**
- Consumes: `Window` from Task 1.
- Produces: `transport::report_router(store: Arc<Store>) -> axum::Router<()>`;
  the Connect path `/sedjiwa.tasks.reports.v1.ReportService/GetPeriodReport`;
  and the generated Rust types under
  `crate::sedjiwa::tasks::reports::v1` (`GetPeriodReportRequest`,
  `PeriodReport`, `PeriodTotals`, `ProjectReportRow`, `MemberReportRow`,
  `ActivitySummaryRow`).

- [ ] **Step 1: Write the failing test**

Create `apps/backend-rs/crates/transport/tests/reports_flow.rs`. It follows
`dashboard_flow.rs` exactly — the helpers are copied deliberately, as every
`*_flow.rs` in this crate carries its own:

```rust
//! End-to-end periodic reports, member-scoped. Skipped unless `DATABASE_URL` is
//! set. Every caller is a fresh user, so scope = this run's projects only and
//! reruns on the persistent dev DB stay isolated.

use std::sync::Arc;

use auth::{sign_jwt, verify_jwt};
use axum::body::{to_bytes, Body};
use axum::extract::Request;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::StatusCode;
use axum::middleware::{from_fn, Next};
use axum::response::Response;
use axum::Router;
use domain::user::{UserPassword, UserPhone, UserProfile, UserStatusComponent};
use persistence::Store;
use serde_json::{json, Value};
use tower::ServiceExt;

const SECRET: &str = "test-secret";
const PROJECT: &str = "/sedjiwa.tasks.project.v1.ProjectService";
const MODULE: &str = "/sedjiwa.tasks.work.v1.ModuleService";
const TASK: &str = "/sedjiwa.tasks.work.v1.TaskService";
const REPORT: &str = "/sedjiwa.tasks.reports.v1.ReportService";

fn uniq() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos().to_string()
}

/// A window wide enough to hold everything this run creates: yesterday to
/// tomorrow. The report is asked about instants, so these are instants.
fn window() -> (String, String, String, String) {
    use time::format_description::well_known::Rfc3339;
    let fmt = |d: i64| {
        (time::OffsetDateTime::now_utc() + time::Duration::days(d))
            .format(&Rfc3339)
            .unwrap()
    };
    (fmt(-1), fmt(1), fmt(-3), fmt(-1))
}

async fn auth_mw(mut req: Request, next: Next) -> Response {
    if let Some(tok) = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
    {
        if let Ok(u) = verify_jwt(tok.trim(), SECRET) {
            req.extensions_mut().insert(u);
        }
    }
    next.run(req).await
}

async fn setup() -> Option<(Router, Arc<Store>)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let store = Arc::new(Store::connect(&url, domain::register_all).await.unwrap());
    let router = transport::project_router(store.clone())
        .merge(transport::module_router(store.clone()))
        .merge(transport::task_router(store.clone()))
        .merge(transport::report_router(store.clone()))
        .layer(from_fn(auth_mw));
    Some((router, store))
}

fn token(sub: &str) -> String {
    sign_jwt(SECRET, sub, &["projects:create".to_string()], 9_999_999_999).unwrap()
}

async fn call(router: &Router, path: &str, token: Option<&str>, body: Value) -> (StatusCode, Value) {
    let mut b = Request::builder().method("POST").uri(path).header(CONTENT_TYPE, "application/json");
    if let Some(t) = token {
        b = b.header(AUTHORIZATION, format!("Bearer {t}"));
    }
    let req = b.body(Body::from(body.to_string())).unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

async fn ok(router: &Router, path: &str, tok: &str, body: Value) -> Value {
    let (st, v) = call(router, path, Some(tok), body).await;
    assert_eq!(st, StatusCode::OK, "{path}: {v}");
    v
}

async fn mk_user(store: &Store) -> String {
    let now = "2026-01-01T00:00:00Z".to_string();
    store
        .create((
            UserPhone { value: format!("r{}", uniq()), verified: true },
            UserPassword { hash: "x".into(), changed_at: now.clone() },
            UserProfile { display_name: "R".into(), avatar_url: String::new(), email: String::new() },
            UserStatusComponent { status: "active".into(), created_at: now, last_login_at: None },
        ))
        .await
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn rejects_a_malformed_window() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let me = mk_user(&store).await;
    let tm = token(&me);

    // An inverted window is a caller error. It must not come back as an empty
    // report, which is a legitimate answer and would hide the bug.
    let (st, body) = call(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        Some(&tm),
        json!({ "periodStart": "2026-09-14T00:00:00Z", "periodEnd": "2026-09-07T00:00:00Z" }),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "{body}");

    let (st, body) = call(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        Some(&tm),
        json!({ "periodStart": "not-a-time", "periodEnd": "2026-09-07T00:00:00Z" }),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "{body}");
}

#[tokio::test]
async fn requires_authentication() {
    let Some((router, _store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let (s, e, _, _) = window();
    let (st, _) = call(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        None,
        json!({ "periodStart": s, "periodEnd": e }),
    )
    .await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn empty_scope_reports_zero() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    // A user who is a member of no project: every count is zero and no row
    // leaks from anyone else's projects.
    let me = mk_user(&store).await;
    let (s, e, ps, pe) = window();
    let r = ok(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        &token(&me),
        json!({ "periodStart": s, "periodEnd": e, "prevStart": ps, "prevEnd": pe }),
    )
    .await;
    assert_eq!(r["totals"]["completed"].as_u64().unwrap_or(0), 0, "{r}");
    assert_eq!(r["totals"]["created"].as_u64().unwrap_or(0), 0, "{r}");
    assert!(r["perProject"].as_array().map(|a| a.is_empty()).unwrap_or(true), "{r}");
    assert!(r["perMember"].as_array().map(|a| a.is_empty()).unwrap_or(true), "{r}");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd apps/backend-rs && DATABASE_URL="$DATABASE_URL" cargo test -p transport --test reports_flow
```
Expected: FAIL to compile — `transport::report_router` does not exist.

**Confirm the tests are not skipping.** If the output says
`skip: DATABASE_URL not set`, stop and set the variable; a skipped test is not a
passing test. Remember the first run against a fresh database fails once — run
it again before concluding anything.

- [ ] **Step 3: Write minimal implementation**

Create `apps/backend-rs/proto/reports.proto`:

```proto
syntax = "proto3";
package sedjiwa.tasks.reports.v1;

import "dashboard.proto";
import "activity.proto";

// Cross-project period reporting. Read-only aggregation over existing Task and
// Activity data — no new entities. Scope is the dashboard's: the caller's member
// projects, or all projects for an admin.
// See docs/superpowers/specs/2026-09-07-periodic-reports-design.md.
service ReportService {
  rpc GetPeriodReport(GetPeriodReportRequest) returns (PeriodReport);
}

message GetPeriodReportRequest {
  // Half-open [start, end), RFC3339 UTC. The client computes them from the
  // viewer's local calendar; the server does not know what a week is.
  string period_start = 1;
  string period_end = 2;
  // The comparison window. Both empty = no comparison.
  string prev_start = 3;
  string prev_end = 4;
  // Cap on completed_tasks / overdue_tasks. 0 = 50.
  uint32 list_limit = 5;
}

// `completed` and `created` are of the window. `still_open` and `overdue` are of
// *now* — a period cannot have a current backlog.
message PeriodTotals {
  uint32 completed = 1;
  uint32 created = 2;
  uint32 still_open = 3;
  uint32 overdue = 4;
}

message ProjectReportRow {
  string project_id = 1;
  string project_name = 2;
  uint32 completed = 3;
  uint32 created = 4;
  uint32 still_open = 5;
  uint32 overdue = 6;
  uint32 done_total = 7; // cumulative; matches DashboardStats.per_project
  uint32 total = 8;
}

message MemberReportRow {
  string user_id = 1;
  string user_name = 2;
  uint32 completed = 3; // completed in window AND assigned to them
  uint32 created = 4;   // created_by them, in window
  uint32 open_assigned = 5;
  uint32 overdue_assigned = 6;
}

message ActivitySummaryRow {
  sedjiwa.tasks.activity.v1.EntityType entity_type = 1;
  sedjiwa.tasks.activity.v1.ActivityAction action = 2;
  uint32 count = 3;
}

message PeriodReport {
  string period_start = 1;
  string period_end = 2;

  PeriodTotals totals = 3;
  PeriodTotals prev_totals = 4; // unset when no comparison window was sent

  repeated ProjectReportRow per_project = 5;
  repeated MemberReportRow per_member = 6;

  // dashboard.v1.MyTask, not a parallel type: the frontend already has
  // mapMyTasks and a row component for it.
  repeated sedjiwa.tasks.dashboard.v1.MyTask completed_tasks = 7;
  repeated sedjiwa.tasks.dashboard.v1.MyTask overdue_tasks = 8;
  bool completed_truncated = 9;
  bool overdue_truncated = 10;

  repeated ActivitySummaryRow activity_summary = 11;
  uint32 activity_total = 12;
}
```

In `apps/backend-rs/crates/transport/build.rs`, add `"../../proto/reports.proto",`
to the `compile_protos` slice (after `dashboard.proto`) **and**
`println!("cargo:rerun-if-changed=../../proto/reports.proto");` to the list
below it. Both lists — missing the second means proto edits stop triggering
rebuilds.

Create `apps/backend-rs/crates/transport/src/reports/report_service.rs`:

```rust
//! ReportService: one RPC, one window, four sections.

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use persistence::Store;

use super::window::Window;
use super::{require_auth, StoreExt};
use crate::sedjiwa::tasks::reports::v1 as pb;
use crate::sedjiwa::tasks::reports::v1::report_service_connect::ReportServiceBuilder;

/// Cap on the task lists. A month of completed work is readable; a year of it
/// is a data dump, and the page says when it truncated.
const DEFAULT_LIST_LIMIT: u32 = 50;

async fn get_period_report(
    Extension(_store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::GetPeriodReportRequest>,
) -> Result<ConnectResponse<pb::PeriodReport>, ConnectError> {
    let _auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let window = Window::parse(&r.period_start, &r.period_end).ok_or_else(|| {
        ConnectError::new_invalid_argument(
            "period_start and period_end must be RFC3339 instants with period_start < period_end",
        )
    })?;
    let _limit = if r.list_limit == 0 { DEFAULT_LIST_LIMIT } else { r.list_limit };

    Ok(ConnectResponse::new(pb::PeriodReport {
        period_start: window.start().to_string(),
        period_end: window.end().to_string(),
        ..Default::default()
    }))
}

/// ReportService router; injects the Store as a request extension.
pub fn report_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    ReportServiceBuilder::<()>::new()
        .get_period_report::<_, (StoreExt, A, ConnectRequest<pb::GetPeriodReportRequest>)>(
            get_period_report,
        )
        .build()
        .layer(Extension(store))
}
```

Replace `apps/backend-rs/crates/transport/src/reports/mod.rs` with the full
module, copying the three helpers from `dashboard/mod.rs` (each feature module in
this crate carries its own copy):

```rust
//! Periodic reports: cross-project aggregation over a caller-supplied window.
//! See docs/superpowers/specs/2026-09-07-periodic-reports-design.md.
//! No new entities; scope is the dashboard's (member projects, admin: all).

mod report_service;
pub(crate) mod window;

pub use report_service::report_router;

use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::ConnectError;
use persistence::Store;

pub(crate) type StoreExt = Extension<Arc<Store>>;

pub(crate) fn internal(e: impl std::fmt::Display) -> ConnectError {
    ConnectError::new_internal(e.to_string())
}

pub(crate) fn require_auth(user: Option<Extension<AuthUser>>) -> Result<AuthUser, ConnectError> {
    user.map(|Extension(u)| u)
        .ok_or_else(|| ConnectError::new_unauthenticated("authentication required"))
}
```

`internal` is unused until Task 5; add `#[allow(dead_code)]` above it now and
remove that attribute in Task 5.

In `apps/backend-rs/crates/transport/src/lib.rs`, add to the `pub use` block:

```rust
pub use reports::report_router;
```

In `apps/backend-rs/crates/app/src/router.rs`, after line 54, add:

```rust
        .merge(transport::report_router(store.clone()))
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd apps/backend-rs && DATABASE_URL="$DATABASE_URL" cargo test -p transport --test reports_flow
```
Expected: PASS, 3 tests, none reporting `skip:`. Then `cargo build -p app` to
confirm the router change compiles.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/proto/reports.proto apps/backend-rs/crates/transport apps/backend-rs/crates/app/src/router.rs
git commit -m "feat(reports): ReportService proto and wired GetPeriodReport endpoint"
```

---

### Task 3: Task aggregation — totals, per-project, per-member, lists

**Files:**
- Create: `apps/backend-rs/crates/transport/src/reports/aggregate.rs`
- Modify: `apps/backend-rs/crates/transport/src/dashboard/mod.rs:5` (`mod context;`
  → `pub(crate) mod context;`)
- Modify: `apps/backend-rs/crates/transport/src/reports/mod.rs` (add `mod aggregate;`)

**Interfaces:**
- Consumes: `Window` (Task 1); the generated `pb` types (Task 2);
  `crate::dashboard::context::{Context, today}`;
  `crate::work::task_record::TaskRecord`; `crate::users::record::load_all_users`.
- Produces, all `pub(crate)` in `reports::aggregate`:
  - `totals(tasks: &[&TaskRecord], w: &Window, today: &str) -> pb::PeriodTotals`
  - `per_project(ctx: &Context, w: &Window, today: &str) -> Vec<pb::ProjectReportRow>`
  - `member_rows(tasks: &[&TaskRecord], w: &Window, today: &str, names: &HashMap<String, String>) -> Vec<pb::MemberReportRow>` — the countable core, testable without a `Context`
  - `per_member(ctx: &Context, w: &Window, today: &str, names: &HashMap<String, String>) -> Vec<pb::MemberReportRow>`
  - `completed_list(ctx: &Context, w: &Window, limit: usize) -> (Vec<MyTask>, bool)`
  - `overdue_list(ctx: &Context, today: &str, limit: usize) -> (Vec<MyTask>, bool)`
  - `is_open(t: &TaskRecord) -> bool`, `is_overdue(t: &TaskRecord, today: &str) -> bool`

- [ ] **Step 1: Write the failing test**

Append to `apps/backend-rs/crates/transport/src/reports/aggregate.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use domain::task::{TaskPriority, TaskStatus};

    const START: &str = "2026-09-07T00:00:00Z";
    const END: &str = "2026-09-14T00:00:00Z";

    fn w() -> Window {
        Window::parse(START, END).unwrap()
    }

    fn task(pid: i64, status: TaskStatus) -> TaskRecord {
        TaskRecord {
            pid,
            module_id: "1".into(),
            title: format!("T{pid}"),
            description: String::new(),
            status,
            priority: TaskPriority::None,
            start_date: None,
            due_date: None,
            order: 0,
            assignee_ids: Vec::new(),
            label_ids: Vec::new(),
            created_at: "2026-09-08T10:00:00Z".into(),
            updated_at: "2026-09-08T10:00:00Z".into(),
            completed_at: None,
            created_by: "1".into(),
            parent_id: None,
            blocked_by_ids: Vec::new(),
        }
    }

    #[test]
    fn totals_count_the_window_for_flow_and_now_for_backlog() {
        let today = "2026-09-20";
        let mut done = task(1, TaskStatus::Done);
        done.completed_at = Some("2026-09-09T09:00:00Z".into());
        // Completed before the window: created counts, completed does not.
        let mut old_done = task(2, TaskStatus::Done);
        old_done.created_at = "2026-09-08T10:00:00Z".into();
        old_done.completed_at = Some("2026-08-01T09:00:00Z".into());
        // Open and overdue right now, created before the window.
        let mut open = task(3, TaskStatus::InProgress);
        open.created_at = "2026-01-01T00:00:00Z".into();
        open.due_date = Some("2026-09-01".into());

        let tasks = vec![&done, &old_done, &open];
        let t = totals(&tasks, &w(), today);

        assert_eq!(t.completed, 1, "only the in-window completion");
        assert_eq!(t.created, 2, "done + old_done were created in the window");
        assert_eq!(t.still_open, 1);
        assert_eq!(t.overdue, 1);
    }

    #[test]
    fn cancelled_tasks_count_nowhere() {
        let mut c = task(1, TaskStatus::Cancelled);
        c.completed_at = Some("2026-09-09T09:00:00Z".into());
        c.due_date = Some("2026-09-01".into());
        let tasks = vec![&c];
        let t = totals(&tasks, &w(), "2026-09-20");
        assert_eq!(t.completed, 0);
        assert_eq!(t.created, 0);
        assert_eq!(t.still_open, 0);
        assert_eq!(t.overdue, 0);
    }

    #[test]
    fn a_done_task_is_never_overdue() {
        let mut done = task(1, TaskStatus::Done);
        done.due_date = Some("2026-09-01".into());
        done.completed_at = Some("2026-09-09T09:00:00Z".into());
        let tasks = vec![&done];
        assert_eq!(totals(&tasks, &w(), "2026-09-20").overdue, 0);
    }

    #[test]
    fn open_means_todo_or_in_progress_only() {
        assert!(is_open(&task(1, TaskStatus::Todo)));
        assert!(is_open(&task(2, TaskStatus::InProgress)));
        assert!(!is_open(&task(3, TaskStatus::Done)));
        assert!(!is_open(&task(4, TaskStatus::Cancelled)));
    }

    #[test]
    fn a_task_with_two_assignees_counts_once_for_each() {
        let mut done = task(1, TaskStatus::Done);
        done.assignee_ids = vec!["7".into(), "8".into()];
        done.completed_at = Some("2026-09-09T09:00:00Z".into());
        done.created_by = "7".into();

        let rows = member_rows(&[&done], &w(), "2026-09-20", &names());
        assert_eq!(rows.len(), 2, "one row per assignee: {rows:?}");
        let seven = rows.iter().find(|r| r.user_id == "7").unwrap();
        let eight = rows.iter().find(|r| r.user_id == "8").unwrap();
        assert_eq!(seven.completed, 1);
        assert_eq!(eight.completed, 1);
        assert_eq!(seven.created, 1, "created keys on created_by");
        assert_eq!(eight.created, 0);
    }

    #[test]
    fn member_rows_are_sorted_and_empty_ones_dropped() {
        let mut a = task(1, TaskStatus::Done);
        a.assignee_ids = vec!["7".into()];
        a.completed_at = Some("2026-09-09T09:00:00Z".into());
        a.created_by = "9".into(); // 9 created it but is not assigned

        let mut b = task(2, TaskStatus::Done);
        b.assignee_ids = vec!["8".into()];
        b.completed_at = Some("2026-09-10T09:00:00Z".into());
        b.created_by = "8".into();

        let mut c = task(3, TaskStatus::Done);
        c.assignee_ids = vec!["7".into()];
        c.completed_at = Some("2026-09-11T09:00:00Z".into());
        c.created_by = "8".into();

        let rows = member_rows(&[&a, &b, &c], &w(), "2026-09-20", &names());
        // 7 has two completions, 8 has one, 9 only created outside the window
        // -> 9 has one `created`, so it stays. Order: by completed desc.
        assert_eq!(rows[0].user_id, "7");
        assert_eq!(rows[0].completed, 2);
        assert_eq!(rows[1].user_id, "8");
        assert!(rows.iter().any(|r| r.user_id == "9" && r.created == 1));
    }

    #[test]
    fn a_member_with_no_user_record_keeps_its_id() {
        let mut done = task(1, TaskStatus::Done);
        done.assignee_ids = vec!["404".into()];
        done.completed_at = Some("2026-09-09T09:00:00Z".into());
        let rows = member_rows(&[&done], &w(), "2026-09-20", &names());
        let row = rows.iter().find(|r| r.user_id == "404").unwrap();
        assert_eq!(row.user_name, "", "missing user renders blank, not dropped");
    }

    fn names() -> std::collections::HashMap<String, String> {
        [("7".to_string(), "Seven".to_string()), ("8".to_string(), "Eight".to_string()),
         ("9".to_string(), "Nine".to_string())]
            .into_iter()
            .collect()
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend-rs && cargo test -p transport --lib reports::aggregate`
Expected: FAIL — `totals`, `is_open`, `member_rows` are not defined.

- [ ] **Step 3: Write minimal implementation**

Change `apps/backend-rs/crates/transport/src/dashboard/mod.rs` line 5:

```rust
/// Shared cross-project aggregation primitive: scope + name maps + every task,
/// loaded once. `reports` uses the same one, so the dashboard and the period
/// report cannot drift on what "done" means.
pub(crate) mod context;
```

Add `mod aggregate;` to `reports/mod.rs`.

Write the implementation above the test module in `aggregate.rs`:

```rust
//! Task-side aggregation for a period report.
//!
//! Everything here reads `Context` — the same scope, the same task set, and the
//! same cancelled-counts-nowhere rule the dashboard uses.

use std::collections::HashMap;

use domain::task::TaskStatus;

use super::window::Window;
use crate::dashboard::context::Context;
use crate::sedjiwa::tasks::dashboard::v1::MyTask;
use crate::sedjiwa::tasks::reports::v1 as pb;
use crate::work::task_record::TaskRecord;

/// Still to be done: `TODO` or `IN_PROGRESS`. Cancelled is not open — it is
/// nothing at all.
pub(crate) fn is_open(t: &TaskRecord) -> bool {
    matches!(t.status, TaskStatus::Todo | TaskStatus::InProgress)
}

/// Open and past its due date, under the existing `Tally` rule: a plain date
/// compared against today (UTC).
pub(crate) fn is_overdue(t: &TaskRecord, today: &str) -> bool {
    is_open(t) && t.due_date.as_ref().is_some_and(|d| d.as_str() < today)
}

fn counts(t: &TaskRecord, w: &Window, today: &str, into: &mut pb::PeriodTotals) {
    if w.contains_opt(t.completed_at.as_ref()) && t.status == TaskStatus::Done {
        into.completed += 1;
    }
    if w.contains(&t.created_at) {
        into.created += 1;
    }
    if is_open(t) {
        into.still_open += 1;
        if is_overdue(t, today) {
            into.overdue += 1;
        }
    }
}

/// The four headline numbers over an already-scoped, already-filtered task set.
pub(crate) fn totals(tasks: &[&TaskRecord], w: &Window, today: &str) -> pb::PeriodTotals {
    let mut out = pb::PeriodTotals::default();
    for t in tasks {
        if t.status == TaskStatus::Cancelled {
            continue;
        }
        counts(t, w, today, &mut out);
    }
    out
}

/// One row per scoped project — including projects with no activity at all,
/// which appear as zeros so a reader can see they were considered.
pub(crate) fn per_project(ctx: &Context, w: &Window, today: &str) -> Vec<pb::ProjectReportRow> {
    let mut rows: HashMap<String, pb::ProjectReportRow> = ctx
        .scoped_projects()
        .into_iter()
        .map(|id| {
            let name = ctx.project_name(&id);
            (
                id.clone(),
                pb::ProjectReportRow { project_id: id, project_name: name, ..Default::default() },
            )
        })
        .collect();

    for t in ctx.scoped_tasks() {
        if t.status == TaskStatus::Cancelled {
            continue;
        }
        let Some(pid) = ctx.module_to_project.get(&t.module_id) else {
            continue;
        };
        let row = rows.entry(pid.clone()).or_insert_with(|| pb::ProjectReportRow {
            project_id: pid.clone(),
            project_name: ctx.project_name(pid),
            ..Default::default()
        });
        row.total += 1;
        if t.status == TaskStatus::Done {
            row.done_total += 1;
        }
        let mut window_counts = pb::PeriodTotals::default();
        counts(t, w, today, &mut window_counts);
        row.completed += window_counts.completed;
        row.created += window_counts.created;
        row.still_open += window_counts.still_open;
        row.overdue += window_counts.overdue;
    }

    let mut out: Vec<pb::ProjectReportRow> = rows.into_values().collect();
    // Same ordering as DashboardStats.per_project, so the two lists read the
    // same way.
    out.sort_by(|a, b| {
        a.project_name.cmp(&b.project_name).then(a.project_id.cmp(&b.project_id))
    });
    out
}

/// Per-member rows over an already-scoped task set. Split from [`per_member`] so
/// the counting rules can be unit-tested without a `Context` (and therefore
/// without a database).
pub(crate) fn member_rows(
    tasks: &[&TaskRecord],
    w: &Window,
    today: &str,
    names: &HashMap<String, String>,
) -> Vec<pb::MemberReportRow> {
    let mut rows: HashMap<String, pb::MemberReportRow> = HashMap::new();

    for t in tasks {
        if t.status == TaskStatus::Cancelled {
            continue;
        }
        let completed = w.contains_opt(t.completed_at.as_ref()) && t.status == TaskStatus::Done;
        let open = is_open(t);
        let overdue = is_overdue(t, today);

        for a in &t.assignee_ids {
            let r = rows.entry(a.clone()).or_insert_with(|| pb::MemberReportRow {
                user_id: a.clone(),
                user_name: names.get(a).cloned().unwrap_or_default(),
                ..Default::default()
            });
            if completed {
                r.completed += 1;
            }
            if open {
                r.open_assigned += 1;
                if overdue {
                    r.overdue_assigned += 1;
                }
            }
        }

        if w.contains(&t.created_at) {
            let r = rows.entry(t.created_by.clone()).or_insert_with(|| pb::MemberReportRow {
                user_id: t.created_by.clone(),
                user_name: names.get(&t.created_by).cloned().unwrap_or_default(),
                ..Default::default()
            });
            r.created += 1;
        }
    }

    let mut out: Vec<pb::MemberReportRow> = rows
        .into_values()
        .filter(|r| r.completed + r.created + r.open_assigned + r.overdue_assigned > 0)
        .collect();
    out.sort_by(|a, b| {
        b.completed
            .cmp(&a.completed)
            .then(a.user_name.cmp(&b.user_name))
            .then(a.user_id.cmp(&b.user_id))
    });
    out
}

pub(crate) fn per_member(
    ctx: &Context,
    w: &Window,
    today: &str,
    names: &HashMap<String, String>,
) -> Vec<pb::MemberReportRow> {
    member_rows(&ctx.scoped_tasks(), w, today, names)
}

/// Tasks completed inside the window, newest first.
pub(crate) fn completed_list(ctx: &Context, w: &Window, limit: usize) -> (Vec<MyTask>, bool) {
    let mut done: Vec<&TaskRecord> = ctx
        .scoped_tasks()
        .into_iter()
        .filter(|t| t.status == TaskStatus::Done && w.contains_opt(t.completed_at.as_ref()))
        .collect();
    done.sort_by(|a, b| b.completed_at.cmp(&a.completed_at).then(b.pid.cmp(&a.pid)));
    take(ctx, done, limit)
}

/// Tasks overdue *now*, most overdue first.
pub(crate) fn overdue_list(ctx: &Context, today: &str, limit: usize) -> (Vec<MyTask>, bool) {
    let mut late: Vec<&TaskRecord> =
        ctx.scoped_tasks().into_iter().filter(|t| is_overdue(t, today)).collect();
    late.sort_by(|a, b| a.due_date.cmp(&b.due_date).then(a.pid.cmp(&b.pid)));
    take(ctx, late, limit)
}

fn take(ctx: &Context, tasks: Vec<&TaskRecord>, limit: usize) -> (Vec<MyTask>, bool) {
    let truncated = tasks.len() > limit;
    (tasks.into_iter().take(limit).map(|t| ctx.to_mytask(t)).collect(), truncated)
}
```

Make `TaskRecord`'s fields reachable from the test module: they are already
`pub` on a `pub(crate)` struct, so no change is needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend-rs && cargo test -p transport --lib reports::`
Expected: PASS — 5 window tests + 7 aggregate tests. Then
`cargo clippy -p transport` with no new warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/crates/transport/src/reports apps/backend-rs/crates/transport/src/dashboard/mod.rs
git commit -m "feat(reports): task aggregation for totals, projects, members and lists"
```

---

### Task 4: Activity summary by indexed counts

**Files:**
- Create: `apps/backend-rs/crates/transport/src/reports/activity_summary.rs`
- Modify: `apps/backend-rs/crates/transport/src/reports/mod.rs` (add `mod activity_summary;`)
- Modify: `apps/backend-rs/crates/transport/tests/reports_flow.rs`

**Interfaces:**
- Consumes: `Window` (Task 1); `pb` types (Task 2);
  `domain::activity::{ActivityInfo, ActivityAction, EntityType}`;
  `persistence::Store::count`.
- Produces:
  `activity_summary(store: &Store, scope: Option<&HashSet<String>>, w: &Window) -> anyhow::Result<(Vec<pb::ActivitySummaryRow>, u32)>`

- [ ] **Step 1: Write the failing test**

Add to `apps/backend-rs/crates/transport/tests/reports_flow.rs`:

```rust
#[tokio::test]
async fn activity_is_summarised_for_the_window_and_scope() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let me = mk_user(&store).await;
    let tm = token(&me);

    // One project, one module, two tasks -> activity rows written by the
    // mutation handlers themselves.
    let p = ok(&router, &format!("{PROJECT}/CreateProject"), &tm, json!({ "name": format!("R-{}", uniq()) })).await
        ["id"].as_str().unwrap().to_string();
    let m = ok(&router, &format!("{MODULE}/CreateModule"), &tm, json!({ "projectId": p, "name": "M" })).await
        ["id"].as_str().unwrap().to_string();
    let t1 = ok(&router, &format!("{TASK}/CreateTask"), &tm, json!({ "moduleId": m, "title": "one" })).await
        ["id"].as_str().unwrap().to_string();
    ok(&router, &format!("{TASK}/UpdateTask"), &tm, json!({ "id": t1, "title": "one edited" })).await;

    let (s, e, ps, pe) = window();
    let r = ok(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        &tm,
        json!({ "periodStart": s, "periodEnd": e, "prevStart": ps, "prevEnd": pe }),
    )
    .await;

    let total = r["activityTotal"].as_u64().unwrap_or(0);
    assert!(total >= 3, "module create + task create + task update: {r}");
    let rows = r["activitySummary"].as_array().unwrap();
    assert!(!rows.is_empty(), "{r}");
    assert!(
        rows.iter().all(|row| row["count"].as_u64().unwrap_or(0) > 0),
        "zero rows must be dropped: {r}"
    );
    let created_tasks = rows.iter().find(|row| row["entityType"] == "TASK" && row["action"] == "CREATED");
    assert!(created_tasks.is_some(), "a TASK/CREATED row is expected: {r}");

    // A window in the far past sees none of it.
    let r_old = ok(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        &tm,
        json!({ "periodStart": "2020-01-01T00:00:00Z", "periodEnd": "2020-01-08T00:00:00Z" }),
    )
    .await;
    assert_eq!(r_old["activityTotal"].as_u64().unwrap_or(0), 0, "{r_old}");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd apps/backend-rs && DATABASE_URL="$DATABASE_URL" cargo test -p transport --test reports_flow activity
```
Expected: FAIL — `activityTotal` is 0 because the handler still returns a default
`PeriodReport`. Confirm the test ran rather than printing `skip:`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/backend-rs/crates/transport/src/reports/activity_summary.rs`:

```rust
//! Activity counts for a report window.
//!
//! Deliberately never loads an activity row. `activity/record.rs` records why:
//! hydrating a pid costs one existence query plus one per registered component
//! type — 22,028 round-trips and ~3.2s for 20 rows on a 672-row dev database. A
//! month of activity is far more than 20 rows, so this counts instead: nineteen
//! `COUNT`s against columns (`project_id`, `entity_type`, `action`,
//! `created_at`) that are all already indexed.

use std::collections::HashSet;

use domain::activity::{ActivityAction, ActivityInfo, EntityType};
use persistence::Store;

use super::window::Window;
use crate::sedjiwa::tasks::reports::v1 as pb;

const ENTITIES: [EntityType; 6] = [
    EntityType::Task,
    EntityType::Module,
    EntityType::Membership,
    EntityType::Ownership,
    EntityType::Page,
    EntityType::Media,
];
const ACTIONS: [ActivityAction; 3] =
    [ActivityAction::Created, ActivityAction::Updated, ActivityAction::Deleted];

/// `(rows, total)`. Rows with a count of zero are dropped — a report listing
/// "Page deleted 0×" is noise.
///
/// `scope` is `None` for an admin (every project matches). Every value
/// interpolated below is either a `&'static str` from `as_str`, an `i64` that
/// parsed, or a `Window` boundary, which `Window::parse` restricts to digits
/// and fixed separators — the rule `sql.rs` exists to enforce.
pub(crate) async fn activity_summary(
    store: &Store,
    scope: Option<&HashSet<String>>,
    w: &Window,
) -> anyhow::Result<(Vec<pb::ActivitySummaryRow>, u32)> {
    let range = format!(
        "created_at >= '{}' AND created_at < '{}'",
        w.start(),
        w.end()
    );

    let base = match scope {
        None => range,
        Some(set) => {
            // Project ids are entity pids rendered as text; parse each so only
            // validated integers reach the predicate.
            let ids: Vec<String> = set
                .iter()
                .filter_map(|p| p.parse::<i64>().ok())
                .map(|n| format!("'{n}'"))
                .collect();
            // A member of no project matches nothing — return without querying
            // rather than emitting `IN ()`, which is a syntax error.
            if ids.is_empty() {
                return Ok((Vec::new(), 0));
            }
            format!("{range} AND project_id IN ({})", ids.join(", "))
        }
    };

    let total = store.count::<ActivityInfo>(Some(&base)).await?;
    if total == 0 {
        return Ok((Vec::new(), 0));
    }

    let mut rows = Vec::new();
    for entity in ENTITIES {
        for action in ACTIONS {
            let pred = format!(
                "{base} AND entity_type = '{}' AND action = '{}'",
                entity.as_str(),
                action.as_str()
            );
            let count = store.count::<ActivityInfo>(Some(&pred)).await?;
            if count > 0 {
                rows.push(pb::ActivitySummaryRow {
                    entity_type: entity.to_proto(),
                    action: action.to_proto(),
                    count,
                });
            }
        }
    }
    Ok((rows, total))
}
```

Add `mod activity_summary;` to `reports/mod.rs`.

Wire it into `report_service.rs` — replace the body of `get_period_report`'s
response construction:

```rust
    let ctx = Context::load(&store, &auth).await.map_err(internal)?;
    let (activity_summary_rows, activity_total) =
        activity_summary(&store, ctx.scope.as_ref(), &window).await.map_err(internal)?;

    Ok(ConnectResponse::new(pb::PeriodReport {
        period_start: window.start().to_string(),
        period_end: window.end().to_string(),
        activity_summary: activity_summary_rows,
        activity_total,
        ..Default::default()
    }))
```

and add the imports it needs at the top of `report_service.rs`:

```rust
use super::activity_summary::activity_summary;
use super::{internal, require_auth, StoreExt};
use crate::dashboard::context::Context;
```

Rename the handler's `Extension(_store)` to `Extension(store)` and `let _auth` to
`let auth`. Remove the `#[allow(dead_code)]` from `internal` in `reports/mod.rs`.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd apps/backend-rs && DATABASE_URL="$DATABASE_URL" cargo test -p transport --test reports_flow
```
Expected: PASS, 4 tests, none skipped.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/crates/transport
git commit -m "feat(reports): activity summary via indexed counts, never hydrated"
```

---

### Task 5: Assemble the full report

**Files:**
- Modify: `apps/backend-rs/crates/transport/src/reports/report_service.rs`
- Modify: `apps/backend-rs/crates/transport/tests/reports_flow.rs`

**Interfaces:**
- Consumes: everything from Tasks 1, 3, 4, plus
  `crate::users::record::load_all_users` and `crate::dashboard::context::today`.
- Produces: a fully populated `PeriodReport`.

- [ ] **Step 1: Write the failing test**

Add to `apps/backend-rs/crates/transport/tests/reports_flow.rs`:

```rust
#[tokio::test]
async fn report_is_member_scoped_and_counts_the_window() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let me = mk_user(&store).await;
    let (to, tm) = (token(&owner), token(&me));

    // P1: owner + me.
    let p1 = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("RP1-{}", uniq()) })).await
        ["id"].as_str().unwrap().to_string();
    ok(&router, &format!("{PROJECT}/AddProjectMember"), &to, json!({ "projectId": p1, "userId": me })).await;
    let m1 = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": p1, "name": "M1" })).await
        ["id"].as_str().unwrap().to_string();

    // A: done and assigned to me -> completed this window, for me.
    let a = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m1, "title": "A", "assigneeIds": [me] })).await
        ["id"].as_str().unwrap().to_string();
    ok(&router, &format!("{TASK}/UpdateTask"), &to, json!({ "id": a, "status": "DONE" })).await;
    // B: open, assigned to me, due long ago -> still_open + overdue now.
    ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m1, "title": "B", "assigneeIds": [me], "dueDate": "2020-01-01" })).await;
    // C: cancelled -> counts nowhere.
    ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m1, "title": "C", "status": "CANCELLED" })).await;

    // P2: owner only. Must not appear in me's report at all.
    let p2 = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("RP2-{}", uniq()) })).await
        ["id"].as_str().unwrap().to_string();
    let m2 = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": p2, "name": "M2" })).await
        ["id"].as_str().unwrap().to_string();
    ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m2, "title": "hidden" })).await;

    let (s, e, ps, pe) = window();
    let r = ok(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        &tm,
        json!({ "periodStart": s, "periodEnd": e, "prevStart": ps, "prevEnd": pe }),
    )
    .await;

    assert_eq!(r["totals"]["completed"].as_u64().unwrap(), 1, "A: {r}");
    assert_eq!(r["totals"]["created"].as_u64().unwrap(), 2, "A and B; C is cancelled: {r}");
    assert_eq!(r["totals"]["stillOpen"].as_u64().unwrap(), 1, "B: {r}");
    assert_eq!(r["totals"]["overdue"].as_u64().unwrap(), 1, "B: {r}");
    assert!(r["prevTotals"].is_object(), "a comparison window was sent: {r}");
    assert_eq!(r["prevTotals"]["completed"].as_u64().unwrap_or(0), 0, "{r}");

    let projects = r["perProject"].as_array().unwrap();
    assert_eq!(projects.len(), 1, "P2 is out of scope: {r}");
    assert_eq!(projects[0]["projectId"], p1);
    assert_eq!(projects[0]["total"].as_u64().unwrap(), 2, "cancelled excluded: {r}");
    assert_eq!(projects[0]["doneTotal"].as_u64().unwrap(), 1);

    let members = r["perMember"].as_array().unwrap();
    let mine = members.iter().find(|m| m["userId"] == me).expect("a row for me");
    assert_eq!(mine["completed"].as_u64().unwrap(), 1);
    assert_eq!(mine["openAssigned"].as_u64().unwrap(), 1);
    assert_eq!(mine["overdueAssigned"].as_u64().unwrap(), 1);
    assert_eq!(mine["userName"], "R", "display name is joined in");

    let completed = r["completedTasks"].as_array().unwrap();
    assert_eq!(completed.len(), 1);
    assert_eq!(completed[0]["task"]["title"], "A");
    assert_eq!(completed[0]["projectName"], projects[0]["projectName"]);
    assert_eq!(r["completedTruncated"], false);

    let late = r["overdueTasks"].as_array().unwrap();
    assert_eq!(late.len(), 1);
    assert_eq!(late[0]["task"]["title"], "B");

    // No comparison window -> no prevTotals.
    let no_prev = ok(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        &tm,
        json!({ "periodStart": s, "periodEnd": e }),
    )
    .await;
    assert!(no_prev["prevTotals"].is_null(), "{no_prev}");
}

#[tokio::test]
async fn list_limit_truncates_and_says_so() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let me = mk_user(&store).await;
    let tm = token(&me);
    let p = ok(&router, &format!("{PROJECT}/CreateProject"), &tm, json!({ "name": format!("RL-{}", uniq()) })).await
        ["id"].as_str().unwrap().to_string();
    let m = ok(&router, &format!("{MODULE}/CreateModule"), &tm, json!({ "projectId": p, "name": "M" })).await
        ["id"].as_str().unwrap().to_string();
    for i in 0..3 {
        let id = ok(&router, &format!("{TASK}/CreateTask"), &tm, json!({ "moduleId": m, "title": format!("t{i}") })).await
            ["id"].as_str().unwrap().to_string();
        ok(&router, &format!("{TASK}/UpdateTask"), &tm, json!({ "id": id, "status": "DONE" })).await;
    }
    let (s, e, _, _) = window();
    let r = ok(
        &router,
        &format!("{REPORT}/GetPeriodReport"),
        &tm,
        json!({ "periodStart": s, "periodEnd": e, "listLimit": 2 }),
    )
    .await;
    assert_eq!(r["completedTasks"].as_array().unwrap().len(), 2, "{r}");
    assert_eq!(r["completedTruncated"], true, "{r}");
    assert_eq!(r["totals"]["completed"].as_u64().unwrap(), 3, "totals are not capped: {r}");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd apps/backend-rs && DATABASE_URL="$DATABASE_URL" cargo test -p transport --test reports_flow
```
Expected: FAIL — totals are zero and the lists are empty. Confirm no `skip:`.

- [ ] **Step 3: Write minimal implementation**

Replace `get_period_report` in `report_service.rs` with the full handler:

```rust
async fn get_period_report(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::GetPeriodReportRequest>,
) -> Result<ConnectResponse<pb::PeriodReport>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let window = Window::parse(&r.period_start, &r.period_end).ok_or_else(|| {
        ConnectError::new_invalid_argument(
            "period_start and period_end must be RFC3339 instants with period_start < period_end",
        )
    })?;
    // A comparison window is optional, but a malformed one is still an error:
    // silently dropping it would show the page "no comparison" for a bug.
    let prev = if r.prev_start.is_empty() && r.prev_end.is_empty() {
        None
    } else {
        Some(Window::parse(&r.prev_start, &r.prev_end).ok_or_else(|| {
            ConnectError::new_invalid_argument(
                "prev_start and prev_end must both be empty, or a valid window",
            )
        })?)
    };
    let limit = if r.list_limit == 0 { DEFAULT_LIST_LIMIT } else { r.list_limit } as usize;

    let ctx = Context::load(&store, &auth).await.map_err(internal)?;
    let today = today();
    let scoped = ctx.scoped_tasks();

    let names: HashMap<String, String> = load_all_users(&store)
        .await
        .map_err(internal)?
        .into_iter()
        .map(|u| (u.pid.to_string(), u.display_name))
        .collect();

    let (completed_tasks, completed_truncated) = completed_list(&ctx, &window, limit);
    let (overdue_tasks, overdue_truncated) = overdue_list(&ctx, &today, limit);
    let (activity_summary_rows, activity_total) =
        activity_summary(&store, ctx.scope.as_ref(), &window).await.map_err(internal)?;

    Ok(ConnectResponse::new(pb::PeriodReport {
        period_start: window.start().to_string(),
        period_end: window.end().to_string(),
        totals: Some(totals(&scoped, &window, &today)),
        prev_totals: prev.as_ref().map(|w| totals(&scoped, w, &today)),
        per_project: per_project(&ctx, &window, &today),
        per_member: per_member(&ctx, &window, &today, &names),
        completed_tasks,
        completed_truncated,
        overdue_tasks,
        overdue_truncated,
        activity_summary: activity_summary_rows,
        activity_total,
    }))
}
```

Imports at the top of `report_service.rs`:

```rust
use std::collections::HashMap;
use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use persistence::Store;

use super::activity_summary::activity_summary;
use super::aggregate::{completed_list, overdue_list, per_member, per_project, totals};
use super::window::Window;
use super::{internal, require_auth, StoreExt};
use crate::dashboard::context::{today, Context};
use crate::sedjiwa::tasks::reports::v1 as pb;
use crate::sedjiwa::tasks::reports::v1::report_service_connect::ReportServiceBuilder;
use crate::users::record::load_all_users;
```

Note on `prev_totals`: `still_open` and `overdue` inside it are today's numbers,
identical to `totals`. That is correct and intentional — only `completed` and
`created` are period quantities, and the UI only renders deltas for those two.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd apps/backend-rs && DATABASE_URL="$DATABASE_URL" cargo test -p transport
```
Expected: PASS across the crate — the new `reports_flow` tests plus every
existing `*_flow` test, and the `reports::` unit tests. Confirm none skipped.
Then `cargo clippy --workspace` with no new warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/crates/transport
git commit -m "feat(reports): assemble the full period report"
```

---

### Task 6: Generated client and the period calendar

**Files:**
- Modify: `apps/frontend/src/lib/gen/` (generated — do not hand-edit)
- Create: `apps/frontend/src/features/reports/types.ts`
- Create: `apps/frontend/src/features/reports/lib/period.ts`

**Interfaces:**
- Consumes: `ReportService` from `@/lib/gen/reports_pb`.
- Produces: `Granularity`, `PeriodWindow`, `periodWindow(granularity, offset, now?)`,
  and the flat report types listed below.

- [ ] **Step 1: Write the failing check**

The frontend has no test runner and this plan does not add one. Write the
assertions as a throwaway script in the scratchpad — it is verification
evidence, not a repo artifact:

```bash
mkdir -p /tmp/claude-scratch && cat > /tmp/claude-scratch/check-period.ts <<'TS'
import { periodWindow } from "/home/qyubit/Workspace/personal/task-management/apps/frontend/src/features/reports/lib/period";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  if (!ok) { failed++; console.error(`FAIL ${label}\n  got  ${got}\n  want ${want}`); }
  else console.log(`ok   ${label}`);
};

// A Wednesday. The week must start on the Monday before it.
const wed = new Date(2026, 8, 9, 15, 30);
const w = periodWindow("weekly", 0, wed);
eq("weekly start is Monday 7 Sep", w.start.toDateString(), new Date(2026, 8, 7).toDateString());
eq("weekly end is the next Monday", w.end.toDateString(), new Date(2026, 8, 14).toDateString());
eq("weekly prev is the week before", w.prevStart.toDateString(), new Date(2026, 7, 31).toDateString());
eq("weekly prevEnd meets start", w.prevEnd.toDateString(), w.start.toDateString());
eq("weekly label", w.label, "7 – 13 Sep 2026");
eq("weekly isCurrent", w.isCurrent, true);

const wPrev = periodWindow("weekly", -1, wed);
eq("offset -1 shifts a week back", wPrev.start.toDateString(), new Date(2026, 7, 31).toDateString());
eq("offset -1 is not current", wPrev.isCurrent, false);

// March against February: the previous month is 28 days, not 30.
const mar = new Date(2026, 2, 15);
const m = periodWindow("monthly", 0, mar);
eq("monthly start", m.start.toDateString(), new Date(2026, 2, 1).toDateString());
eq("monthly end", m.end.toDateString(), new Date(2026, 3, 1).toDateString());
eq("previous month starts 1 Feb", m.prevStart.toDateString(), new Date(2026, 1, 1).toDateString());
eq("previous month ends 1 Mar", m.prevEnd.toDateString(), new Date(2026, 2, 1).toDateString());
eq("monthly label", m.label, "March 2026");

// Boundaries are local midnight, so the wire value carries the offset.
eq("start is local midnight", w.start.getHours(), 0);

process.exit(failed === 0 ? 0 : 1);
TS
cd apps/frontend && bun /tmp/claude-scratch/check-period.ts
```

- [ ] **Step 2: Run the check to verify it fails**

Run: `cd apps/frontend && bun /tmp/claude-scratch/check-period.ts`
Expected: FAIL — the module `features/reports/lib/period` does not exist.

- [ ] **Step 3: Write minimal implementation**

Regenerate the Connect clients first:

```bash
cd apps/frontend && ./node_modules/.bin/buf generate
```

That writes `src/lib/gen/reports_pb.ts`. Do not hand-edit it.

Create `apps/frontend/src/features/reports/types.ts`:

```typescript
// Flat FE types for the periodic reports domain, mapped from gen/reports_pb.

import type { MyTaskItem } from "@/features/dashboard";
import type { ActivityAction, ActivityEntity } from "@/features/activity";

export type Granularity = "weekly" | "monthly";

/** A resolved period: the window to ask for, and how to name it. */
export interface PeriodWindow {
  granularity: Granularity;
  /** 0 = the period in progress, -1 = the one before it. Never positive. */
  offset: number;
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  label: string;
  isCurrent: boolean;
}

/** `completed`/`created` are of the window; `stillOpen`/`overdue` are of now. */
export interface PeriodTotals {
  completed: number;
  created: number;
  stillOpen: number;
  overdue: number;
}

export interface ProjectReportRow {
  projectId: string;
  projectName: string;
  completed: number;
  created: number;
  stillOpen: number;
  overdue: number;
  doneTotal: number;
  total: number;
}

export interface MemberReportRow {
  userId: string;
  userName: string;
  completed: number;
  created: number;
  openAssigned: number;
  overdueAssigned: number;
}

export interface ActivitySummaryRow {
  entity: ActivityEntity;
  action: ActivityAction;
  count: number;
}

export interface PeriodReport {
  periodStart: string;
  periodEnd: string;
  totals: PeriodTotals;
  prevTotals: PeriodTotals | null;
  perProject: ProjectReportRow[];
  perMember: MemberReportRow[];
  completedTasks: MyTaskItem[];
  completedTruncated: boolean;
  overdueTasks: MyTaskItem[];
  overdueTruncated: boolean;
  activitySummary: ActivitySummaryRow[];
  activityTotal: number;
}
```

Create `apps/frontend/src/features/reports/lib/period.ts`:

```typescript
// All calendar arithmetic for the report lives here, in the browser, in the
// viewer's local time. The server is sent two instants and never asked what a
// week is — see the spec's "the client owns the calendar" decision.

import {
  addMonths,
  addWeeks,
  format,
  startOfMonth,
  startOfWeek,
  subDays,
} from "date-fns";
import type { Granularity, PeriodWindow } from "../types";

/**
 * Resolve a granularity + offset into a half-open `[start, end)` window and its
 * comparison window.
 *
 * The previous window is a calendar step back, not a fixed number of days:
 * February is 28 days and March is 31, so "minus 30 days" would compare a month
 * against something that is not a month.
 */
export function periodWindow(
  granularity: Granularity,
  offset: number,
  now: Date = new Date(),
): PeriodWindow {
  const weekly = granularity === "weekly";
  const start = weekly
    ? addWeeks(startOfWeek(now, { weekStartsOn: 1 }), offset)
    : addMonths(startOfMonth(now), offset);
  const end = weekly ? addWeeks(start, 1) : addMonths(start, 1);
  const prevStart = weekly ? addWeeks(start, -1) : addMonths(start, -1);

  // The label names the days the period covers, so it ends on the last day
  // inside it — not on the exclusive bound, which belongs to the next period.
  const lastDay = subDays(end, 1);
  const label = weekly
    ? `${format(start, "d MMM")} – ${format(lastDay, "d MMM yyyy")}`
    : format(start, "MMMM yyyy");

  return {
    granularity,
    offset,
    start,
    end,
    prevStart,
    prevEnd: start,
    label,
    isCurrent: offset === 0,
  };
}
```

- [ ] **Step 4: Run the check to verify it passes**

Run:
```bash
cd apps/frontend && bun /tmp/claude-scratch/check-period.ts && bun run tsc --noEmit
```
Expected: every assertion `ok`, exit 0, and a clean type-check.

- [ ] **Step 5: Commit**

Do not commit the scratchpad script.

```bash
git add apps/frontend/src/lib/gen apps/frontend/src/features/reports
git commit -m "feat(reports): generated client, flat types, and period calendar"
```

---

### Task 7: Data hooks and proto mappers

**Files:**
- Create: `apps/frontend/src/features/reports/api/mappers.ts`
- Create: `apps/frontend/src/features/reports/api/hooks.ts`
- Create: `apps/frontend/src/features/reports/atoms/period.ts`
- Create: `apps/frontend/src/features/reports/index.ts`
- Modify: `apps/frontend/src/features/activity/api/mappers.ts` (export the two
  enum mappers)
- Modify: `apps/frontend/src/features/activity/index.ts` (re-export them)

**Interfaces:**
- Consumes: `periodWindow` and the types from Task 6; `mapMyTasks` from
  `@/features/dashboard`; `mapEntity`/`mapAction` from `@/features/activity`.
- Produces: `usePeriodReport(window: PeriodWindow)` returning
  `{ ...queryResult, report: PeriodReport | null }`; `mapReport`;
  `periodAtom` (a Jotai atom holding `{ granularity, offset }`).

- [ ] **Step 1: Write the failing check**

Extend the scratchpad script to cover the one piece of mapper logic worth
pinning — that an absent `prevTotals` becomes `null` rather than zeros, because
zeros would render as a real "-100%" delta:

```bash
cat > /tmp/claude-scratch/check-mappers.ts <<'TS'
import { mapReport } from "/home/qyubit/Workspace/personal/task-management/apps/frontend/src/features/reports/api/mappers";
import { create } from "@bufbuild/protobuf";
import { PeriodReportSchema, PeriodTotalsSchema } from "/home/qyubit/Workspace/personal/task-management/apps/frontend/src/lib/gen/reports_pb";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  if (!ok) { failed++; console.error(`FAIL ${label}\n  got  ${got}\n  want ${want}`); }
  else console.log(`ok   ${label}`);
};

const bare = create(PeriodReportSchema, { periodStart: "a", periodEnd: "b" });
eq("absent prevTotals maps to null", mapReport(bare).prevTotals, null);
eq("absent totals maps to zeros", mapReport(bare).totals.completed, 0);

const withPrev = create(PeriodReportSchema, {
  periodStart: "a",
  periodEnd: "b",
  totals: create(PeriodTotalsSchema, { completed: 5 }),
  prevTotals: create(PeriodTotalsSchema, { completed: 2 }),
});
eq("present prevTotals is carried", mapReport(withPrev).prevTotals?.completed, 2);
eq("totals are carried", mapReport(withPrev).totals.completed, 5);

process.exit(failed === 0 ? 0 : 1);
TS
cd apps/frontend && bun /tmp/claude-scratch/check-mappers.ts
```

- [ ] **Step 2: Run the check to verify it fails**

Run: `cd apps/frontend && bun /tmp/claude-scratch/check-mappers.ts`
Expected: FAIL — `mapReport` does not exist.

- [ ] **Step 3: Write minimal implementation**

In `apps/frontend/src/features/activity/api/mappers.ts`, change
`function mapEntity` and `function mapAction` to `export function` — the report's
activity summary needs the same proto-enum → string table, and a second copy
would be a second place to forget a new entity type.

In `apps/frontend/src/features/activity/index.ts`, add them to the mapper export:

```typescript
export { mapActivity, mapEntity, mapAction } from "./api/mappers";
```

Create `apps/frontend/src/features/reports/api/mappers.ts`:

```typescript
import type {
  PeriodReport as PbReport,
  PeriodTotals as PbTotals,
  ProjectReportRow as PbProjectRow,
  MemberReportRow as PbMemberRow,
  ActivitySummaryRow as PbActivityRow,
} from "@/lib/gen/reports_pb";
import { mapMyTasks } from "@/features/dashboard";
import { mapAction, mapEntity } from "@/features/activity";
import type {
  ActivitySummaryRow,
  MemberReportRow,
  PeriodReport,
  PeriodTotals,
  ProjectReportRow,
} from "../types";

const ZERO: PeriodTotals = {
  completed: 0,
  created: 0,
  stillOpen: 0,
  overdue: 0,
};

function mapTotals(t: PbTotals): PeriodTotals {
  return {
    completed: t.completed,
    created: t.created,
    stillOpen: t.stillOpen,
    overdue: t.overdue,
  };
}

function mapProjectRow(p: PbProjectRow): ProjectReportRow {
  return {
    projectId: p.projectId,
    projectName: p.projectName,
    completed: p.completed,
    created: p.created,
    stillOpen: p.stillOpen,
    overdue: p.overdue,
    doneTotal: p.doneTotal,
    total: p.total,
  };
}

function mapMemberRow(m: PbMemberRow): MemberReportRow {
  return {
    userId: m.userId,
    userName: m.userName,
    completed: m.completed,
    created: m.created,
    openAssigned: m.openAssigned,
    overdueAssigned: m.overdueAssigned,
  };
}

function mapActivityRow(a: PbActivityRow): ActivitySummaryRow {
  return {
    entity: mapEntity(a.entityType),
    action: mapAction(a.action),
    count: a.count,
  };
}

/** Absent `prevTotals` stays null, never zeros: zeros would render as a real
 *  "−100%" delta against a period that was simply never asked about. */
export function mapReport(r: PbReport): PeriodReport {
  return {
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    totals: r.totals ? mapTotals(r.totals) : ZERO,
    prevTotals: r.prevTotals ? mapTotals(r.prevTotals) : null,
    perProject: r.perProject.map(mapProjectRow),
    perMember: r.perMember.map(mapMemberRow),
    completedTasks: mapMyTasks(r.completedTasks),
    completedTruncated: r.completedTruncated,
    overdueTasks: mapMyTasks(r.overdueTasks),
    overdueTruncated: r.overdueTruncated,
    activitySummary: r.activitySummary.map(mapActivityRow),
    activityTotal: r.activityTotal,
  };
}
```

Create `apps/frontend/src/features/reports/api/hooks.ts`:

```typescript
// Period report read hook (connect-query). Cross-project aggregation, scoped to
// the caller's member projects (admin = all).

import { useQuery } from "@connectrpc/connect-query";
import { ReportService } from "@/lib/gen/reports_pb";
import type { PeriodReport, PeriodWindow } from "../types";
import { mapReport } from "./mappers";

export function usePeriodReport(window: PeriodWindow) {
  const result = useQuery(ReportService.method.getPeriodReport, {
    // Local midnight, expressed as an instant. The server truncates these to
    // whole seconds and compares stored timestamps against them.
    periodStart: window.start.toISOString(),
    periodEnd: window.end.toISOString(),
    prevStart: window.prevStart.toISOString(),
    prevEnd: window.prevEnd.toISOString(),
  });
  const report: PeriodReport | null = result.data ? mapReport(result.data) : null;
  return { ...result, report };
}
```

Create `apps/frontend/src/features/reports/atoms/period.ts`:

```typescript
import { atom } from "jotai";
import type { Granularity } from "../types";

/** Which period the page is showing. Session-local: a report is read, not
 *  configured, so there is nothing here worth persisting between visits. */
export const periodAtom = atom<{ granularity: Granularity; offset: number }>({
  granularity: "weekly",
  offset: -1, // the last complete period — the one a team actually reports on
});
```

Create `apps/frontend/src/features/reports/index.ts`:

```typescript
// Periodic reports feature barrel.

export type {
  ActivitySummaryRow,
  Granularity,
  MemberReportRow,
  PeriodReport,
  PeriodTotals,
  PeriodWindow,
  ProjectReportRow,
} from "./types";
export { periodWindow } from "./lib/period";
export { mapReport } from "./api/mappers";
export { usePeriodReport } from "./api/hooks";
export { periodAtom } from "./atoms/period";
```

- [ ] **Step 4: Run the check to verify it passes**

Run:
```bash
cd apps/frontend && bun /tmp/claude-scratch/check-mappers.ts && bun run tsc --noEmit && bun run lint
```
Expected: every assertion `ok`, clean type-check, clean lint.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/features/reports apps/frontend/src/features/activity
git commit -m "feat(reports): period report hook, mappers and period atom"
```

---

### Task 8: The report sections

Six presentational components. No data fetching here except the one hook call in
the page (Task 9) — these take props.

**Files:**
- Create: `apps/frontend/src/features/reports/components/period-picker.tsx`
- Create: `apps/frontend/src/features/reports/components/report-totals.tsx`
- Create: `apps/frontend/src/features/reports/components/project-report-table.tsx`
- Create: `apps/frontend/src/features/reports/components/member-report-table.tsx`
- Create: `apps/frontend/src/features/reports/components/report-task-list.tsx`
- Create: `apps/frontend/src/features/reports/components/activity-summary.tsx`
- Modify: `apps/frontend/src/features/reports/index.ts`

**Interfaces:**
- Consumes: the flat types from Task 6; `MyTaskRow` and `StatCard` from existing
  features; `Card`/`CardContent`/`Skeleton` from `@/components/ui`.
- Produces: `PeriodPicker`, `ReportTotals`, `ProjectReportTable`,
  `MemberReportTable`, `ReportTaskList`, `ActivitySummary`.

**Before writing any of this, invoke the `ui-design` skill.** The token system is
locked and documented in `src/styles/tokens.css`; contrast pairs are measured,
not chosen. Only layer-2 semantic tokens, only the locked type scale.

- [ ] **Step 1: Write the components**

`period-picker.tsx` — granularity toggle, previous/next, and the period label.
It is a control, so it carries `print:hidden`:

```tsx
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Granularity, PeriodWindow } from "../types";

/** Period navigation. Moving forward past the current period is not offered:
 *  a report about a period that has not happened is an empty page, not an
 *  answer. */
export function PeriodPicker({
  window,
  onGranularity,
  onOffset,
}: {
  window: PeriodWindow;
  onGranularity: (g: Granularity) => void;
  onOffset: (offset: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
      <div className="flex items-center gap-1 rounded-lg bg-surface-sunken p-1">
        {(["weekly", "monthly"] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => onGranularity(g)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors [transition-duration:var(--duration-fast)]",
              window.granularity === g
                ? "bg-surface-raised text-text shadow-1"
                : "text-text-muted hover:text-text",
            )}
            aria-pressed={window.granularity === g}
          >
            {g === "weekly" ? "Weekly" : "Monthly"}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="hit-area"
          onClick={() => onOffset(window.offset - 1)}
          aria-label="Previous period"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-num min-w-48 text-center text-sm font-medium">
          {window.label}
          {window.isCurrent && (
            <span className="text-label ml-2 align-middle">in progress</span>
          )}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="hit-area"
          onClick={() => onOffset(Math.min(0, window.offset + 1))}
          disabled={window.offset >= 0}
          aria-label="Next period"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
```

`report-totals.tsx` — four numbers, two of which carry a delta:

```tsx
import { AlertTriangle, CheckCircle2, ListTodo, Plus } from "lucide-react";
import { StatCard } from "@/components/shared/stat-card";
import type { PeriodTotals } from "../types";

/** The delta line under a period quantity.
 *
 *  Only `completed` and `created` get one: they are quantities *of the window*,
 *  so a previous window is a like-for-like comparison. `stillOpen` and
 *  `overdue` are today's backlog under both windows — comparing them would
 *  always read zero and imply nothing changed. */
function Delta({ now, before }: { now: number; before: number | null }) {
  if (before === null) return null;
  const diff = now - before;
  const sign = diff > 0 ? "+" : "";
  return (
    <span className="text-num text-xs text-text-muted">
      {sign}
      {diff} vs previous ({before})
    </span>
  );
}

export function ReportTotals({
  totals,
  prev,
}: {
  totals: PeriodTotals;
  prev: PeriodTotals | null;
}) {
  return (
    <div className="space-y-3 print:break-inside-avoid">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={CheckCircle2} label="Completed" value={totals.completed} />
        <StatCard icon={Plus} label="Created" value={totals.created} />
        <StatCard icon={ListTodo} label="Still open" value={totals.stillOpen} />
        <StatCard icon={AlertTriangle} label="Overdue" value={totals.overdue} alert />
      </div>
      {prev && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Delta now={totals.completed} before={prev.completed} />
          <Delta now={totals.created} before={prev.created} />
          <span />
          <span />
        </div>
      )}
    </div>
  );
}
```

`project-report-table.tsx` — the per-project table with a cumulative progress
bar:

```tsx
import { Link } from "@tanstack/react-router";
import type { ProjectReportRow } from "../types";

export function ProjectReportTable({ rows }: { rows: ProjectReportRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl bg-surface-raised p-6 text-center text-sm text-text-muted shadow-2">
        No projects in scope.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl bg-surface-raised shadow-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle">
            <th className="text-label px-4 py-3 text-left">Project</th>
            <th className="text-label px-4 py-3 text-right">Completed</th>
            <th className="text-label px-4 py-3 text-right">Created</th>
            <th className="text-label px-4 py-3 text-right">Open</th>
            <th className="text-label px-4 py-3 text-right">Overdue</th>
            <th className="text-label px-4 py-3 text-right">Progress</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pct = r.total > 0 ? Math.round((r.doneTotal / r.total) * 100) : 0;
            return (
              <tr
                key={r.projectId}
                className="border-b border-border-subtle last:border-b-0 print:break-inside-avoid"
              >
                <td className="px-4 py-3">
                  <Link
                    to="/projects/$projectId/all-tasks"
                    params={{ projectId: r.projectId }}
                    className="truncate font-medium hover:underline"
                  >
                    {r.projectName}
                  </Link>
                </td>
                <td className="text-num px-4 py-3 text-right">{r.completed}</td>
                <td className="text-num px-4 py-3 text-right">{r.created}</td>
                <td className="text-num px-4 py-3 text-right">{r.stillOpen}</td>
                <td className="text-num px-4 py-3 text-right">
                  {r.overdue > 0 ? (
                    <span className="text-danger">{r.overdue}</span>
                  ) : (
                    r.overdue
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-sunken">
                      <span
                        className="block h-full rounded-full bg-brand"
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span className="text-num text-xs text-text-muted">
                      {r.doneTotal}/{r.total}
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

`member-report-table.tsx` — same table shape, member columns:

```tsx
import type { MemberReportRow } from "../types";

export function MemberReportTable({ rows }: { rows: MemberReportRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl bg-surface-raised p-6 text-center text-sm text-text-muted shadow-2">
        Nobody completed or created anything in this period.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl bg-surface-raised shadow-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle">
            <th className="text-label px-4 py-3 text-left">Member</th>
            <th className="text-label px-4 py-3 text-right">Completed</th>
            <th className="text-label px-4 py-3 text-right">Created</th>
            <th className="text-label px-4 py-3 text-right">Open</th>
            <th className="text-label px-4 py-3 text-right">Overdue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.userId}
              className="border-b border-border-subtle last:border-b-0 print:break-inside-avoid"
            >
              {/* A member whose user record is gone keeps its id, so their work
                  is still counted rather than silently disappearing. */}
              <td className="px-4 py-3 font-medium">
                {r.userName || `User ${r.userId}`}
              </td>
              <td className="text-num px-4 py-3 text-right">{r.completed}</td>
              <td className="text-num px-4 py-3 text-right">{r.created}</td>
              <td className="text-num px-4 py-3 text-right">{r.openAssigned}</td>
              <td className="text-num px-4 py-3 text-right">
                {r.overdueAssigned > 0 ? (
                  <span className="text-danger">{r.overdueAssigned}</span>
                ) : (
                  r.overdueAssigned
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

`report-task-list.tsx` — reuses the dashboard's row:

```tsx
import { MyTaskRow } from "@/features/dashboard";
import type { MyTaskItem } from "@/features/dashboard";

export function ReportTaskList({
  items,
  truncated,
  empty,
}: {
  items: MyTaskItem[];
  truncated: boolean;
  empty: string;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl bg-surface-raised p-6 text-center text-sm text-text-muted shadow-2">
        {empty}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-xl bg-surface-raised shadow-2">
        {items.map((it) => (
          <MyTaskRow key={it.task.id} item={it} />
        ))}
      </div>
      {truncated && (
        <p className="text-xs text-text-muted">
          Showing the first {items.length}. The counts above are complete.
        </p>
      )}
    </div>
  );
}
```

`activity-summary.tsx` — counted, not listed:

```tsx
import { Link } from "@tanstack/react-router";
import type { ActivitySummaryRow } from "../types";

const ENTITY_LABEL: Record<string, string> = {
  task: "Task",
  module: "Module",
  membership: "Membership",
  ownership: "Ownership",
  page: "Page",
  media: "Media",
  other: "Other",
};

const ACTION_LABEL: Record<string, string> = {
  created: "created",
  updated: "updated",
  deleted: "deleted",
  other: "changed",
};

/** Counts, not rows. A month of activity is thousands of entries; the feed is
 *  where those belong, and this links to it. */
export function ActivitySummary({
  rows,
  total,
}: {
  rows: ActivitySummaryRow[];
  total: number;
}) {
  if (total === 0) {
    return (
      <p className="rounded-xl bg-surface-raised p-6 text-center text-sm text-text-muted shadow-2">
        No recorded activity in this period.
      </p>
    );
  }
  return (
    <div className="rounded-xl bg-surface-raised p-4 shadow-2 print:break-inside-avoid">
      <ul className="grid gap-2 sm:grid-cols-2">
        {rows.map((r) => (
          <li
            key={`${r.entity}-${r.action}`}
            className="flex items-baseline justify-between gap-3 text-sm"
          >
            <span className="text-text-muted">
              {ENTITY_LABEL[r.entity]} {ACTION_LABEL[r.action]}
            </span>
            <span className="text-num font-medium">{r.count}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-text-muted">
        {total} recorded changes.{" "}
        <Link to="/dashboard" className="text-brand-text underline print:hidden">
          See the activity feed
        </Link>
      </p>
    </div>
  );
}
```

Add all six to `features/reports/index.ts`:

```typescript
export { PeriodPicker } from "./components/period-picker";
export { ReportTotals } from "./components/report-totals";
export { ProjectReportTable } from "./components/project-report-table";
export { MemberReportTable } from "./components/member-report-table";
export { ReportTaskList } from "./components/report-task-list";
export { ActivitySummary } from "./components/activity-summary";
```

- [ ] **Step 2: Verify they compile and lint**

Run: `cd apps/frontend && bun run tsc --noEmit && bun run lint`
Expected: both clean. `MyTaskItem` must be exported as a type from
`@/features/dashboard` — it already is.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/features/reports
git commit -m "feat(reports): period picker, totals, tables, lists and activity summary"
```

---

### Task 9: The page and its navigation entry

**Files:**
- Create: `apps/frontend/src/routes/_authed/reports.tsx`
- Modify: `apps/frontend/src/features/auth/components/app-shell.tsx` (the `NAV`
  array at line 30 and its lucide import block)
- Modify: `apps/frontend/src/routeTree.gen.ts` (generated by the router plugin —
  do not hand-edit)

**Interfaces:**
- Consumes: everything from Tasks 6–8.
- Produces: the route `/reports`.

- [ ] **Step 1: Write the page**

Create `apps/frontend/src/routes/_authed/reports.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ActivitySummary,
  MemberReportTable,
  PeriodPicker,
  ProjectReportTable,
  ReportTaskList,
  ReportTotals,
  periodAtom,
  periodWindow,
  usePeriodReport,
} from "@/features/reports";

export const Route = createFileRoute("/_authed/reports")({
  component: ReportsPage,
});

function ReportsPage() {
  const [period, setPeriod] = useAtom(periodAtom);
  // `new Date()` is not a stable dependency, so pin the window per selection —
  // otherwise every render produces new instants and refetches the report.
  const window = useMemo(
    () => periodWindow(period.granularity, period.offset),
    [period.granularity, period.offset],
  );
  const { report, isLoading } = usePeriodReport(window);

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-semibold">Reports</h1>
      </div>

      <PeriodPicker
        window={window}
        onGranularity={(granularity) => setPeriod({ granularity, offset: period.offset })}
        onOffset={(offset) => setPeriod({ granularity: period.granularity, offset })}
      />

      {isLoading || !report ? (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full rounded-xl shadow-2" />
          <Skeleton className="h-48 w-full rounded-xl shadow-2" />
        </div>
      ) : (
        <>
          <ReportTotals totals={report.totals} prev={report.prevTotals} />

          <section>
            <h2 className="text-label mb-3">Per project</h2>
            <ProjectReportTable rows={report.perProject} />
          </section>

          <section>
            <h2 className="text-label mb-3">Per member</h2>
            <MemberReportTable rows={report.perMember} />
          </section>

          <section>
            <h2 className="text-label mb-3">Completed this period</h2>
            <ReportTaskList
              items={report.completedTasks}
              truncated={report.completedTruncated}
              empty="Nothing was completed in this period."
            />
          </section>

          <section>
            <h2 className="text-label mb-3">Overdue now</h2>
            <ReportTaskList
              items={report.overdueTasks}
              truncated={report.overdueTruncated}
              empty="Nothing is overdue."
            />
          </section>

          <section>
            <h2 className="text-label mb-3">Activity</h2>
            <ActivitySummary rows={report.activitySummary} total={report.activityTotal} />
          </section>
        </>
      )}
    </div>
  );
}
```

In `app-shell.tsx`, add `FileBarChart` to the lucide import block (alphabetical,
after `ChevronsUpDown`) and this entry to `NAV`, after `My tasks`:

```typescript
    { to: "/reports", label: "Reports", icon: FileBarChart },
```

No `adminOnly`: the scoping is per member on the server, and every member can
read a report about their own projects.

- [ ] **Step 2: Verify the route builds**

Run: `cd apps/frontend && bun run build`
Expected: PASS — `routeTree.gen.ts` regenerates with the `/reports` route and the
build succeeds. The page has no print masthead yet; Task 10 adds it.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/routes apps/frontend/src/features/auth/components/app-shell.tsx
git commit -m "feat(reports): /reports page and sidebar entry"
```

---

### Task 10: Print output

**Files:**
- Create: `apps/frontend/src/styles/print.css`
- Create: `apps/frontend/src/features/reports/components/report-print-header.tsx`
- Modify: `apps/frontend/src/index.css` (import print.css last)
- Modify: `apps/frontend/src/features/reports/index.ts`
- Modify: `apps/frontend/src/features/auth/components/app-shell.tsx` (hide the
  sidebar and action bar in print)

**Interfaces:**
- Consumes: `PeriodWindow` (Task 6); `currentUserAtom` from `@/features/auth`.
- Produces: `ReportPrintHeader`.

- [ ] **Step 1: Write the print stylesheet**

Create `apps/frontend/src/styles/print.css`:

```css
/* ============================================================
   Print palette.

   Deliberately ONE palette for both themes rather than a restoration of the
   light one: a printed sheet should look the same whoever printed it, and
   printing the dark theme wastes ink and reads badly on paper.

   These override :root and .dark alike because both selectors match <html>
   with equal specificity — so this file MUST be imported after tokens.css.
   Only tokens the report actually uses are redefined; anything else keeps its
   screen value and never reaches paper.
   ============================================================ */

@media print {
  :root {
    --surface: #ffffff;
    --surface-raised: #ffffff;
    --surface-sunken: #f2f3f5;
    --surface-hover: #ffffff;

    --text: #16181d;
    --text-muted: #43474f;
    --text-subtle: #555a63;

    --border: #d3d6dc;
    --border-subtle: #e5e7eb;
    --border-strong: #979da7;

    /* A muted, ink-friendly blue for the progress bars — not the screen brand. */
    --brand: #3c4a5e;
    --brand-text: #16181d;

    --danger: #8a1f11;
    --danger-subtle: #fbeae8;
    --success: #14532d;
    --success-subtle: #e9f4ed;
    --warning: #6b3f00;
    --warning-subtle: #fbf1e0;

    /* Shadows are how the screen separates surfaces. On paper they print as
       grey smudges, so separation falls to the borders above. */
    --shadow-1: none;
    --shadow-2: none;
    --shadow-3: none;
    --shadow-4: none;
    --shadow-5: none;
  }

  body {
    background: #ffffff;
  }

  @page {
    margin: 14mm;
  }
}
```

In `apps/frontend/src/index.css`, add the import directly after the animations
import and before the dialog utilities:

```css
@import "./styles/print.css" layer(base);
```

- [ ] **Step 2: Write the print header**

Create `apps/frontend/src/features/reports/components/report-print-header.tsx`:

```tsx
import { useAtomValue } from "jotai";
import { format } from "date-fns";
import { currentUserAtom } from "@/features/auth";
import { APP_NAME } from "@/lib/app-config";
import type { PeriodWindow } from "../types";

/** Print-only masthead. A sheet that leaves the app has to say what it is, what
 *  period it covers, and when it was taken — otherwise it is a page of numbers
 *  with no provenance. */
export function ReportPrintHeader({ window }: { window: PeriodWindow }) {
  const user = useAtomValue(currentUserAtom);
  return (
    <header className="hidden border-b border-border pb-4 print:block">
      <h1 className="text-xl font-semibold">
        {window.granularity === "weekly" ? "Weekly" : "Monthly"} report
      </h1>
      <p className="text-num text-sm text-text-muted">{window.label}</p>
      <p className="mt-1 text-xs text-text-subtle">
        {APP_NAME} · printed {format(new Date(), "d MMM yyyy HH:mm")}
        {user?.displayName ? ` · ${user.displayName}` : ""}
      </p>
    </header>
  );
}
```

Export it from `features/reports/index.ts`:

```typescript
export { ReportPrintHeader } from "./components/report-print-header";
```

Then add it to the page. In `apps/frontend/src/routes/_authed/reports.tsx`, add
`ReportPrintHeader` to the existing `@/features/reports` import and render it
directly above `<PeriodPicker …/>`:

```tsx
      <ReportPrintHeader window={window} />
```

Confirm `currentUserAtom` is exported from `@/features/auth` and that its value
has a `displayName`; if the field is named differently there, use that name
rather than adding a mapping.

- [ ] **Step 3: Hide the shell in print**

In `app-shell.tsx`, add `print:hidden` to the class list of the sidebar `<aside>`
(or `<nav>`) element and to the action-bar element above the `<Outlet/>`. Do not
touch the token classes on those elements — read the contrast comment at the top
of the file first.

- [ ] **Step 4: Verify**

Run:
```bash
cd apps/frontend && bun run tsc --noEmit && bun run lint && bun run build
```
Expected: all three clean.

Then check the print output by eye: run `bun run dev`, open `/reports`, and use
the browser's print preview (Ctrl+P). Confirm — the sidebar and period controls
are gone, the masthead appears, the page is dark-on-white in **both** themes, and
no table row is split across a page break.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/styles apps/frontend/src/index.css apps/frontend/src/features
git commit -m "feat(reports): print stylesheet and print-only report masthead"
```

---

## Final verification

Run every gate, and confirm each one actually ran:

```bash
cd apps/backend-rs && DATABASE_URL="$DATABASE_URL" cargo test -p transport
cd apps/backend-rs && cargo clippy --workspace
cd apps/frontend && bun run tsc --noEmit && bun run lint && bun run build
```

A backend test run that prints `skip: DATABASE_URL not set` has verified nothing.
The first run against a fresh database fails once; run it again before drawing a
conclusion.
