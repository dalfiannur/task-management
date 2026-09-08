//! Task-side aggregation for a period report.
//!
//! The counting rules (`totals`, `is_open`, `is_overdue`, `member_rows`) work
//! over a plain task slice, with no `Context` involved, so they can be
//! unit-tested without a database. The `Context`-taking wrappers
//! (`per_project`, `per_member`, `completed_list`, `overdue_list`) apply those
//! same rules to the caller's scope — the same scope, the same task set, and
//! the same cancelled-counts-nowhere rule the dashboard uses.

use std::collections::HashMap;

use domain::task::TaskStatus;

use super::window::{DateWindow, Window};
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

/// Did this task *start* inside the period?
///
/// `start_date` when the task has one — that is when the work was scheduled to
/// begin, which is what a period report is asking about. `created_at` is only
/// the administrative trace of someone typing the task in.
///
/// `start_date` is optional, and a task without one would otherwise fall out of
/// every period and disappear from the report. So it falls back to `created_at`.
/// The cost of that choice is stated plainly: this one number mixes two
/// meanings, and a reader cannot tell which rows came from which.
///
/// The two fields are different shapes — a plain local date and a UTC instant —
/// so each is compared against the boundary of its own type. They are never
/// compared against each other; see [`DateWindow`] for what goes wrong if they
/// are.
fn started(t: &TaskRecord, w: &Window, dw: &DateWindow) -> bool {
    match t.start_date.as_ref() {
        Some(d) => dw.contains(d),
        None => w.contains(&t.created_at),
    }
}

fn counts(t: &TaskRecord, w: &Window, dw: &DateWindow, today: &str, into: &mut pb::PeriodTotals) {
    if w.contains_opt(t.completed_at.as_ref()) && t.status == TaskStatus::Done {
        into.completed += 1;
    }
    if started(t, w, dw) {
        into.started += 1;
    }
    if is_open(t) {
        into.still_open += 1;
        if is_overdue(t, today) {
            into.overdue += 1;
        }
    }
}

/// The four headline numbers over an already-scoped, already-filtered task set.
pub(crate) fn totals(
    tasks: &[&TaskRecord],
    w: &Window,
    dw: &DateWindow,
    today: &str,
) -> pb::PeriodTotals {
    let mut out = pb::PeriodTotals::default();
    for t in tasks {
        if t.status == TaskStatus::Cancelled {
            continue;
        }
        counts(t, w, dw, today, &mut out);
    }
    out
}

/// One row per scoped project — including projects with no activity at all,
/// which appear as zeros so a reader can see they were considered.
pub(crate) fn per_project(
    ctx: &Context,
    w: &Window,
    dw: &DateWindow,
    today: &str,
) -> Vec<pb::ProjectReportRow> {
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
        // Cumulative (all-time, not window-scoped) counting, deliberately
        // duplicated from `dashboard::dashboard_service::get_dashboard_stats`
        // rather than shared — the report must not modify dashboard code.
        // Keep the two in sync by hand if the "done/total" rule ever changes.
        row.total += 1;
        if t.status == TaskStatus::Done {
            row.done_total += 1;
        }
        let mut window_counts = pb::PeriodTotals::default();
        counts(t, w, dw, today, &mut window_counts);
        row.completed += window_counts.completed;
        row.started += window_counts.started;
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
    dw: &DateWindow,
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

        // Keyed on who created the task, but windowed on when the work
        // started — the same `started` rule the totals use.
        if started(t, w, dw) {
            let r = rows.entry(t.created_by.clone()).or_insert_with(|| pb::MemberReportRow {
                user_id: t.created_by.clone(),
                user_name: names.get(&t.created_by).cloned().unwrap_or_default(),
                ..Default::default()
            });
            r.started += 1;
        }
    }

    let mut out: Vec<pb::MemberReportRow> = rows
        .into_values()
        .filter(|r| r.completed + r.started + r.open_assigned + r.overdue_assigned > 0)
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
    dw: &DateWindow,
    today: &str,
    names: &HashMap<String, String>,
) -> Vec<pb::MemberReportRow> {
    member_rows(&ctx.scoped_tasks(), w, dw, today, names)
}

/// Tasks completed inside the window, newest first.
pub(crate) fn completed_list(ctx: &Context, w: &Window, limit: usize) -> (Vec<MyTask>, bool) {
    let mut done: Vec<&TaskRecord> = ctx
        .scoped_tasks()
        .into_iter()
        .filter(|t| t.status == TaskStatus::Done && w.contains_opt(t.completed_at.as_ref()))
        .collect();
    // Deliberately *not* truncated the way `window.rs` truncates boundaries:
    // this sorts raw stored `completed_at` strings, so within the same
    // second a fractional timestamp can sort as earlier than a plain one
    // that actually preceded it (`.` is below `Z` lexicographically). That's
    // cosmetic — same-second ordering in a list, not a window boundary — so
    // it's left as-is rather than paying for truncation on every comparison.
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

#[cfg(test)]
mod tests {
    use super::*;
    use domain::task::{TaskPriority, TaskStatus};

    const START: &str = "2026-09-07T00:00:00Z";
    const END: &str = "2026-09-14T00:00:00Z";

    fn w() -> Window {
        Window::parse(START, END).unwrap()
    }

    /// The same period as local calendar dates: Mon 7 Sep through Sun 13 Sep,
    /// with `end` the first day of the next week.
    fn dw() -> DateWindow {
        DateWindow::parse("2026-09-07", "2026-09-14").unwrap()
    }

    /// `member_rows` with both windows filled in from the fixtures above.
    fn member_rows_dw(
        tasks: &[&TaskRecord],
        w: &Window,
        today: &str,
        names: &HashMap<String, String>,
    ) -> Vec<pb::MemberReportRow> {
        member_rows(tasks, w, &dw(), today, names)
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
        let t = totals(&tasks, &w(), &dw(), today);

        assert_eq!(t.completed, 1, "only the in-window completion");
        assert_eq!(t.started, 2, "done + old_done: no start_date, so created_at is used");
        assert_eq!(t.still_open, 1);
        assert_eq!(t.overdue, 1);
    }

    #[test]
    fn started_prefers_start_date_over_created_at() {
        let today = "2026-09-20";

        // Created long before the period, but scheduled to start inside it.
        // Under the old created_at rule this task was invisible; it is exactly
        // the case the change exists for.
        let mut scheduled = task(1, TaskStatus::Todo);
        scheduled.created_at = "2026-01-01T00:00:00Z".into();
        scheduled.start_date = Some("2026-09-09".into());

        // Typed in during the period, but scheduled for later. It counted
        // before and must not now.
        let mut deferred = task(2, TaskStatus::Todo);
        deferred.created_at = "2026-09-08T10:00:00Z".into();
        deferred.start_date = Some("2026-10-01".into());

        let tasks = vec![&scheduled, &deferred];
        assert_eq!(totals(&tasks, &w(), &dw(), today).started, 1, "only the scheduled one");
    }

    #[test]
    fn a_task_without_a_start_date_falls_back_to_created_at() {
        let today = "2026-09-20";

        let mut inside = task(1, TaskStatus::Todo); // helper default created_at is in-window
        inside.start_date = None;

        let mut outside = task(2, TaskStatus::Todo);
        outside.start_date = None;
        outside.created_at = "2026-01-01T00:00:00Z".into();

        let tasks = vec![&inside, &outside];
        assert_eq!(totals(&tasks, &w(), &dw(), today).started, 1);
    }

    #[test]
    fn start_date_boundaries_are_the_periods_own_days() {
        // The reason `start_date` is compared against a DateWindow and never
        // against the instant bounds. Against those, "2026-09-07" is a prefix
        // of "2026-09-07T00:00:00" and sorts below it, so the period's first
        // day would vanish — and it sorts below the end bound too, so the next
        // period's first day would be counted. Both ends wrong, opposite ways.
        let today = "2026-09-20";
        let day = |pid: i64, d: &str| {
            let mut t = task(pid, TaskStatus::Todo);
            t.created_at = "2026-01-01T00:00:00Z".into(); // keep the fallback out of it
            t.start_date = Some(d.to_string());
            t
        };
        let first = day(1, "2026-09-07");
        let last = day(2, "2026-09-13");
        let next = day(3, "2026-09-14");
        let prev = day(4, "2026-09-06");

        let tasks = vec![&first, &last, &next, &prev];
        assert_eq!(
            totals(&tasks, &w(), &dw(), today).started,
            2,
            "the period's first and last day, and neither neighbour"
        );
    }

    #[test]
    fn cancelled_tasks_count_nowhere() {
        let mut c = task(1, TaskStatus::Cancelled);
        c.completed_at = Some("2026-09-09T09:00:00Z".into());
        c.due_date = Some("2026-09-01".into());
        let tasks = vec![&c];
        let t = totals(&tasks, &w(), &dw(), "2026-09-20");
        assert_eq!(t.completed, 0);
        assert_eq!(t.started, 0);
        assert_eq!(t.still_open, 0);
        assert_eq!(t.overdue, 0);
    }

    #[test]
    fn a_done_task_is_never_overdue() {
        let mut done = task(1, TaskStatus::Done);
        done.due_date = Some("2026-09-01".into());
        done.completed_at = Some("2026-09-09T09:00:00Z".into());
        let tasks = vec![&done];
        assert_eq!(totals(&tasks, &w(), &dw(), "2026-09-20").overdue, 0);
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

        let rows = member_rows_dw(&[&done], &w(), "2026-09-20", &names());
        assert_eq!(rows.len(), 2, "one row per assignee: {rows:?}");
        let seven = rows.iter().find(|r| r.user_id == "7").unwrap();
        let eight = rows.iter().find(|r| r.user_id == "8").unwrap();
        assert_eq!(seven.completed, 1);
        assert_eq!(eight.completed, 1);
        assert_eq!(seven.started, 1, "keyed on created_by, windowed on start");
        assert_eq!(eight.started, 0);
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

        let rows = member_rows_dw(&[&a, &b, &c], &w(), "2026-09-20", &names());
        // 7 has two completions, 8 has one; 9 is never assigned but is
        // `created_by` on task 1, whose `created_at` is the helper's default
        // and lands inside the window -> 9 has one `created`, so it stays.
        // Order: by completed desc.
        assert_eq!(rows[0].user_id, "7");
        assert_eq!(rows[0].completed, 2);
        assert_eq!(rows[1].user_id, "8");
        assert!(rows.iter().any(|r| r.user_id == "9" && r.started == 1));
    }

    #[test]
    fn open_and_overdue_assigned_are_counted_separately() {
        let today = "2026-09-20";
        let mut overdue = task(1, TaskStatus::InProgress);
        overdue.assignee_ids = vec!["7".into()];
        overdue.due_date = Some("2026-09-01".into()); // past today

        let rows = member_rows_dw(&[&overdue], &w(), today, &names());
        let seven = rows.iter().find(|r| r.user_id == "7").unwrap();
        assert_eq!(seven.open_assigned, 1);
        assert_eq!(seven.overdue_assigned, 1, "open and past its due date");

        let mut not_overdue = task(2, TaskStatus::Todo);
        not_overdue.assignee_ids = vec!["7".into()];
        not_overdue.due_date = None; // no due date -> never overdue

        let rows = member_rows_dw(&[&overdue, &not_overdue], &w(), today, &names());
        let seven = rows.iter().find(|r| r.user_id == "7").unwrap();
        assert_eq!(seven.open_assigned, 2, "both open tasks are assigned to 7");
        assert_eq!(seven.overdue_assigned, 1, "only the past-due one is overdue");
    }

    #[test]
    fn a_member_with_only_zero_rows_is_dropped() {
        let mut old = task(1, TaskStatus::Done);
        old.assignee_ids = vec!["7".into()];
        old.completed_at = Some("2026-08-01T09:00:00Z".into()); // before the window
        old.created_at = "2026-08-01T09:00:00Z".into(); // before the window too
        old.created_by = "9".into(); // not 7, so 7 gets no `created` either

        let rows = member_rows_dw(&[&old], &w(), "2026-09-20", &names());
        assert!(
            rows.iter().all(|r| r.user_id != "7"),
            "an all-zero row must be dropped, not kept: {rows:?}"
        );
    }

    #[test]
    fn a_member_with_no_user_record_keeps_its_id() {
        let mut done = task(1, TaskStatus::Done);
        done.assignee_ids = vec!["404".into()];
        done.completed_at = Some("2026-09-09T09:00:00Z".into());
        let rows = member_rows_dw(&[&done], &w(), "2026-09-20", &names());
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
