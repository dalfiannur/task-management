# Periodic Reports (Weekly / Monthly) — Flow Design

**Date:** 2026-09-07
**Status:** approved, ready for planning

## Goal

Answer a question the app cannot answer today: *what did we get done last week?*

Every existing read surface is a snapshot of **now**. `DashboardService` counts
open, done and overdue tasks as they stand this instant; the project Overview tab
does the same for one project; the activity feed is an undated firehose. Nothing
in twelve protos can be asked about a closed interval — and "how did last month
go" is the question a team asks when it reports upward.

The raw material is already in the database. `Task` carries `completed_at` and
`created_at`; `ActivityInfo` carries an indexed `created_at`. What is missing is
the notion of a period, and a page that reads like a report.

## Scope

A cross-project, organisation-level report over a chosen week or month:

- Throughput: completed and started in the window, against the comparable
  previous window.
- A per-project table.
- A per-member table.
- The concrete lists — tasks completed, tasks overdue — plus a counted summary of
  activity.
- Print/PDF output through the browser.

Out of scope, deliberately:

- **Stored report entities.** No `Report` table, no scheduled generation, no
  frozen archive. See the decision below.
- **A per-project report tab.** The project Overview tab already exists; a period
  view for one project can reuse this same RPC later by narrowing scope, and that
  is a separate piece of work.
- **A personal "my week" report.** Same reason — the aggregation is the same, the
  surface is not.
- **CSV/XLSX export of the report.** `ExportService` is the place for that if it
  is ever wanted; the page prints today.
- **Charting libraries.** The project has none, and the token system is strict
  (see the contrast notes in `app-shell.tsx`). Proportions render as CSS bars,
  the way per-project progress already does.

## Governance

STD-0006 routes consequential changes through RFC → ADR. This is additive: a new
read-only service alongside thirteen existing ones, no invariant touched, no core
technology changed. The precedent is `ExportService` and the MCP server, both of
which shipped from a superpowers spec without an RFC. STD-0007 (published data
contracts carry a version field) does not bind either — nothing here is published
or exported; a printed page is not a data contract.

## Decision: a service of its own, reusing the dashboard's aggregation context

`reports.proto` and `crates/transport/src/reports/` are new. The aggregation
primitive is not.

`dashboard/context.rs` already loads, in one pass, exactly what a cross-project
report needs: the caller's member-project scope (admin: all), every task, and the
project/module name maps. `reports` reuses it verbatim. One word changes in
`dashboard/mod.rs` — `mod context;` becomes `pub(crate) mod context;` — plus a doc
line recording that `Context` is now the shared cross-project aggregation
primitive rather than a dashboard-private helper.

That reuse is the point, not a convenience. If the report computed "done" under
its own rules, the report and the dashboard would eventually disagree about the
same project on the same day, and a user would have no way to tell which lied.

Rejected alternatives:

- **Bolt the RPC onto `DashboardService`.** Fewest files. But `dashboard.proto`
  already carries two services and nine messages; a report with four sections
  turns it into a catch-all, and the boundary blurs further the moment a
  per-project or personal report is added.
- **Aggregate in the client.** There is no cross-project `ListTasks` — it is
  per-project — so this means N requests. Worse, member scoping would move to the
  browser, and that is an authorisation rule that must stay on the server.

## Decision: computed on demand, no stored report entity

The report is derived on each request. No new table, no scheduler, no
current-period special case.

The cost is stated plainly: numbers for a past period are not frozen. Edit a task
that was completed in July and July's report changes. For a team reading its own
work that is the correct behaviour — the report tracks the data. For an audit
trail it is not, and if that need appears, the API is already shaped for it: the
request names an explicit window, so a stored snapshot can be introduced later as
a cache in front of the same computation, without changing the response shape.

## Decision: the client owns the calendar, the server owns the scope

The request carries **instants**, not calendar words:

```
period_start, period_end   // RFC3339 UTC, half-open [start, end)
prev_start,   prev_end     // the comparison window, same shape; may be empty
```

Two problems disappear at once.

**Timezone.** Existing date logic is UTC — `context.rs:130` renders `today()` as
a UTC date, and `overdue` compares `due_date` against it. That is defensible for
a due date, which is a plain date. It is wrong for a report boundary: a viewer in
WIB (UTC+7) asking for "last week" means midnight Monday local, and a UTC-day
boundary misses by seven hours. Because the client converts its local
`startOfWeek` to a UTC instant before sending, the server never needs a timezone
database and never needs a second date convention beside the existing one.

**The calendar.** "The previous month" is not "minus 30 days" — February has 28,
March has 31. Rather than teach the server calendar arithmetic that date-fns
already does correctly in the browser, the client sends both windows. The server
filters ranges; it does not know what a week is.

Empty `prev_start`/`prev_end` mean no comparison: `prev_totals` is left unset and
the page renders no deltas.

## Decision: boundary comparison at second precision

Stored timestamps are inconsistent in width. `transport::now_iso()` formats
RFC3339 **without** pinning nanoseconds, so `created_at` may be
`2026-09-07T10:23:45Z` or `2026-09-07T10:23:45.123456789Z` depending on the
instant. (`domain::token::now_iso` pins to whole seconds and documents why;
transport's copy does not.) Compared lexicographically against a boundary, a
fractional value can sort on the wrong side of a non-fractional one — `.` (0x2E)
is below `Z` (0x5A).

The rule that removes the problem entirely:

> Truncate the **boundary** to 19 characters (`YYYY-MM-DDTHH:MM:SS`, dropping the
> fraction and the `Z`). Compare the **stored value as it is**, with `>=` for the
> lower bound and `<` for the upper.

Every stored form then orders correctly against it. A fractional value shares the
19-character prefix and is longer, so it sorts above the truncated boundary — as
it should, being later within that second. A non-fractional value ends in `Z`,
also above. A value in a different second differs before character 19 and never
reaches the ambiguity. The result is exact at second precision on both bounds,
and — because it is a plain range predicate on an unmodified column — it stays
index-friendly for the activity SQL.

This is not a fuzz that we tolerate. It is a rule that makes the comparison
correct, and it is unit-tested on both bounds with both stored forms.

## Decision: activity is counted, never hydrated

`activity/record.rs:70` records an expensive lesson: hydrating activity rows
costs roughly 33 round-trips each, because hydrating a pid runs one existence
query plus one per registered component type. Measured against a 672-row dev
database: 22,028 round-trips, ~3.2s, for 20 rows.

A month of activity is far more than 20 rows, so the report never loads them. The
activity summary runs `store.count::<ActivityInfo>(predicate)` once per
entity_type × action pair (6 × 3) plus one total — nineteen cheap counts against
columns that are all already indexed (`project_id`, `entity_type`, `action`,
`created_at`). Pairs with a count of zero are dropped from the response.

The consequence for the UI is deliberate: the report shows *"Task updated 142×"*,
not 142 rows, and links to the activity feed for the detail. A month-long raw
feed inside a report is not a report.

## Decision: the period counts when work was *scheduled to start*

`started` keys on the task's `start_date`, not on `created_at`. `created_at` is
the administrative trace of someone typing the task in; `start_date` is when the
work was meant to begin, and that is the question a period report asks.

`start_date` is optional. A task without one would fall out of every period and
vanish from the report entirely, so it falls back to `created_at`. The cost is
paid in full and stated plainly: this single number mixes two meanings, and a
reader cannot tell which rows came from which. The alternative — dropping
unscheduled tasks — was rejected because a report that silently omits work is
worse than one that counts it under a slightly loose definition.

The two fields are different shapes, and that is the trap this decision has to
handle. `created_at` is a UTC instant; `start_date` is a plain local date with
no time and no zone. Comparing a plain date against the instant bounds is wrong
at **both** ends, in opposite directions: `"2026-09-07"` is a prefix of
`"2026-09-07T00:00:00"` and so sorts below it, dropping every task that starts
on the period's first day — and it sorts below the end bound too, so a task
starting on the *next* period's first day is wrongly counted.

Truncating the instant bounds to their date prefix does not fix it either. Those
bounds are local midnight expressed in UTC, so for a viewer at UTC+7 the week
beginning Monday is sent as `2026-09-06T17:00:00`, whose prefix is the previous
day. So the client sends the calendar dates separately, computed in its own
local time — the same principle as the instants, applied to the other shape.
`DateWindow` is a distinct type from `Window` for exactly this reason: a single
type holding both invites the comparison that must never happen.

## API

`apps/backend-rs/proto/reports.proto`, package `sedjiwa.tasks.reports.v1`:

```proto
import "dashboard.proto";
import "activity.proto";

service ReportService {
  rpc GetPeriodReport(GetPeriodReportRequest) returns (PeriodReport);
}

message GetPeriodReportRequest {
  // Half-open [start, end), RFC3339 UTC. The client computes them from the
  // viewer's local calendar; the server does not know what a week is.
  string period_start = 1;
  string period_end   = 2;
  // The comparison window. Both empty = no comparison.
  string prev_start   = 3;
  string prev_end     = 4;
  // The same window as plain local calendar dates, for task fields that are
  // themselves plain dates rather than instants — `start_date`. They cannot be
  // derived from the instants: those are local midnight expressed in UTC, so at
  // UTC+7 the Monday-starting week arrives as 2026-09-06T17:00:00, whose date
  // prefix is the previous day.
  string period_start_date = 6;
  string period_end_date   = 7;
  string prev_start_date   = 8;
  string prev_end_date     = 9;
  // Cap on completed_tasks / overdue_tasks. 0 = DEFAULT_LIST_LIMIT (50).
  uint32 list_limit   = 5;
}

// `completed` and `started` are of the window. `still_open` and `overdue` are
// of *now* — a period cannot have a current backlog.
message PeriodTotals {
  uint32 completed  = 1;
  uint32 started    = 2;
  uint32 still_open = 3;
  uint32 overdue    = 4;
}

message ProjectReportRow {
  string project_id   = 1;
  string project_name = 2;
  uint32 completed    = 3;
  uint32 started      = 4;
  uint32 still_open   = 5;
  uint32 overdue      = 6;
  uint32 done_total   = 7;  // cumulative, matches DashboardStats.per_project
  uint32 total        = 8;
}

message MemberReportRow {
  string user_id          = 1;
  string user_name        = 2;
  uint32 completed        = 3;  // completed in window AND assigned to them
  uint32 started          = 4;  // created_by them, started in window
  uint32 open_assigned    = 5;
  uint32 overdue_assigned = 6;
}

message ActivitySummaryRow {
  sedjiwa.tasks.activity.v1.EntityType     entity_type = 1;
  sedjiwa.tasks.activity.v1.ActivityAction action      = 2;
  uint32                                   count       = 3;
}

message PeriodReport {
  string period_start = 1;
  string period_end   = 2;

  PeriodTotals totals      = 3;
  PeriodTotals prev_totals = 4;  // unset when no comparison window was sent

  repeated ProjectReportRow per_project = 5;
  repeated MemberReportRow  per_member  = 6;

  // dashboard.v1.MyTask, not a parallel type: the frontend already has
  // mapMyTasks and a row component for it.
  repeated sedjiwa.tasks.dashboard.v1.MyTask completed_tasks = 7;
  repeated sedjiwa.tasks.dashboard.v1.MyTask overdue_tasks   = 8;
  bool completed_truncated = 9;
  bool overdue_truncated   = 10;

  repeated ActivitySummaryRow activity_summary = 11;
  uint32                      activity_total   = 12;
}
```

## Counting rules

One table, because these are the rules the implementation and the tests must
agree on exactly.

| Quantity | Rule |
|---|---|
| Cancelled tasks | Counted nowhere, in any section. Mirrors `Tally::add`, so the report and the dashboard cannot drift. |
| `completed` | `completed_at` within `[period_start, period_end)` under the 19-character rule. |
| `started` | `start_date` within `[period_start_date, period_end_date)` when the task has one; otherwise `created_at` within the instant window. See the decision below. |
| `still_open` | Status `TODO` or `IN_PROGRESS` **now**. Not window-scoped. |
| `overdue` | `still_open` and `due_date < today()` (UTC), the existing `Tally` rule. Not window-scoped. |
| Per-project rows | Every project in scope appears, including ones with no activity, as zeros. Sorted by project name, then id — the `DashboardStats` ordering. |
| Per-member rows | Keyed by user; a task with two assignees counts once for each. `started` keys on `created_by` for *who*, and on the `started` rule for *when*. Members with nothing in the window and nothing open are dropped. Sorted by `completed` descending, then name. |
| `completed_tasks` | Window-completed tasks, newest `completed_at` first, capped at `list_limit`, with `completed_truncated` set when the cap bit. |
| `overdue_tasks` | Overdue **now**, earliest `due_date` first, same cap semantics. |
| Activity | Counted per entity_type × action within the window, over scoped projects only. |

## Backend

```
crates/transport/src/reports/
├── mod.rs               # router + shared helpers, mirroring dashboard/mod.rs
├── window.rs            # Window { start, end }; parsing, validation, containment
├── aggregate.rs         # totals / per-project / per-member from &Context + Window
├── activity_summary.rs  # the nineteen counts
└── report_service.rs    # the handler
```

Member display names come from `users::record::load_all_users`, already
`pub(crate)` — one load per request, joined to the ids `Context` yields. A member
row whose user record is missing keeps its id and renders with an empty name
rather than vanishing, so a deleted account's work is not silently uncounted.

Scope is `Context`'s: member project ids, or `None` for admin. The activity
predicate reuses the `project_id IN (…)` construction from `activity_recent_page`
— including its early return for a user who is a member of no project, which
exists so the query never emits `IN ()`.

Validation: `period_start` and `period_end` must parse as RFC3339 and
`start < end`, else `invalid_argument`. A malformed window must not silently
return an empty report — an empty report is a legitimate answer and would hide
the bug.

Registration: `reports.proto` in both lists in `crates/transport/build.rs`,
`pub use reports::report_router;` in `lib.rs`, and
`.merge(transport::report_router(store.clone()))` in `crates/app/src/router.rs`.

## Frontend

```
src/features/reports/
├── api/hooks.ts          # usePeriodReport(window)
├── api/mappers.ts        # PeriodReport → flat types; reuses mapMyTasks
├── lib/period.ts         # all calendar arithmetic
├── components/
│   ├── period-picker.tsx
│   ├── report-totals.tsx        # four cards + deltas
│   ├── project-report-table.tsx
│   ├── member-report-table.tsx
│   ├── report-task-list.tsx     # reuses the dashboard's MyTask row
│   ├── activity-summary.tsx
│   └── report-print-header.tsx
├── types.ts
└── index.ts
```

Route `src/routes/_authed/reports.tsx`, thin like `dashboard.tsx`. One new `NAV`
entry in `app-shell.tsx` — **not** `adminOnly`, because the scoping is enforced
per member on the server.

`lib/period.ts` owns the calendar: `startOfWeek(base, { weekStartsOn: 1 })` for
Monday-based weeks, `startOfMonth`, and `addWeeks`/`addMonths` for the upper
bound and the comparison window. Navigation is an `offset` (0 = current period,
−1 = previous). The current period is viewable but labelled as in progress, so
its numbers are not mistaken for final; navigating into the future is not
offered.

Page order — which is also print order: period picker → four summary cards with
deltas → per-project table → per-member table → completed and overdue lists →
activity summary. Single column; it reads top to bottom on paper.

The `ui-design` skill applies during implementation. The token system is strict
and documented at length in `app-shell.tsx`; contrast pairs are not to be
improvised.

## Print

No dependency; the browser's Save as PDF.

- `@media print` hides the sidebar, the action bar, and the period controls, and
  lets content run full width.
- `report-print-header` is print-only (`hidden print:block`): title, period
  range, generated-at, and the viewer's name, so the sheet stands alone once it
  leaves the app.
- Light tokens are forced inside `@media print`. Printing the dark theme wastes
  ink and reads badly.
- `break-inside: avoid` on cards and table rows.

## Permissions

Identical to `DashboardService`, by construction rather than by restatement: a
member sees their member projects, an admin sees all. No new permission, no new
gate. The per-member table is visible to every member — the team's own throughput
is not privileged information here. If that ever needs to change, it changes in
one place, the assembly of `per_member`.

## Known limits

- `Context::load` reads every task in the database on each call. That is the cost
  the dashboard already pays; the report inherits it rather than adding a new
  class of cost. Fixing it means a windowed task query and belongs to whichever
  piece of work takes on dashboard performance.
- Past periods are not frozen. Editing old data changes old reports.
- `transport::now_iso()` still does not pin nanoseconds. The 19-character rule
  makes the report correct despite that; it does not fix the underlying
  inconsistency, which remains for anything else comparing those strings.

## Testing

Rust unit tests, on the rules most likely to be got wrong:

- A task completed exactly at `period_start` is in; exactly at `period_end` is
  out.
- Stored values with and without a fractional second classify identically on both
  bounds.
- Cancelled tasks appear in no count.
- A two-assignee task counts once for each member.

`crates/transport/tests/reports_flow.rs`, following `dashboard_flow.rs`, for the
end-to-end path: a member sees only their projects, an admin sees all, a scoped
project with no activity still appears as a zero row, and a malformed window
returns `invalid_argument`.

Backend tests skip silently when the DATABASE_URL variables are unset, and the
first run against a fresh database always fails once. Both are known; the report
tests must be confirmed to have actually run, not merely to have gone green.

Frontend has no test framework. The gates are `bun run tsc --noEmit`,
`bun run lint`, and `vite build`, plus `./node_modules/.bin/buf generate` after
the proto lands.
