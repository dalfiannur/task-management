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
