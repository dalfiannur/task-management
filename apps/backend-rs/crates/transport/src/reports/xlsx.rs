//! The period report as an .xlsx workbook — one sheet per section of the page.
//!
//! Dates are written as real Excel dates, not text, so they sort and filter.
//! A task's `start_date`/`due_date` is a plain calendar date and goes in as-is;
//! an instant (`completed_at`, the generation time) is shifted by the viewer's
//! UTC offset first, so the cell shows the wall-clock time they saw on the page.

use domain::activity::{ActivityAction, EntityType};
use domain::task::{TaskPriority, TaskStatus};
use rust_xlsxwriter::{Color, ExcelDateTime, Format, Workbook, Worksheet, XlsxError};
use time::format_description::well_known::Rfc3339;
use time::{OffsetDateTime, UtcOffset};

use crate::sedjiwa::tasks::dashboard::v1 as dash_pb;
use crate::sedjiwa::tasks::reports::v1 as pb;

const DATE_FMT: &str = "dd mmm yyyy";
const DATETIME_FMT: &str = "dd mmm yyyy hh:mm";

pub(crate) struct Meta<'a> {
    pub granularity: &'a str,
    pub label: &'a str,
    pub by: &'a str,
    pub app_name: &'a str,
    pub utc_offset_minutes: i32,
}

fn offset(minutes: i32) -> UtcOffset {
    UtcOffset::from_whole_seconds(minutes.saturating_mul(60)).unwrap_or(UtcOffset::UTC)
}

/// A `yyyy-MM-dd` calendar date; `None` if it doesn't parse.
fn plain_date(value: &str) -> Option<ExcelDateTime> {
    let mut parts = value.get(..10)?.split('-');
    let y = parts.next()?.parse().ok()?;
    let m = parts.next()?.parse().ok()?;
    let d = parts.next()?.parse().ok()?;
    ExcelDateTime::from_ymd(y, m, d).ok()
}

/// An instant as the viewer's wall-clock time.
fn wall_clock(t: OffsetDateTime, off: UtcOffset) -> Option<ExcelDateTime> {
    let t = t.to_offset(off);
    ExcelDateTime::from_ymd(t.year().try_into().ok()?, t.month().into(), t.day())
        .ok()?
        .and_hms(t.hour().into(), t.minute(), t.second())
        .ok()
}

fn instant(value: &str, off: UtcOffset) -> Option<ExcelDateTime> {
    wall_clock(OffsetDateTime::parse(value, &Rfc3339).ok()?, off)
}

struct Col {
    header: &'static str,
    width: f64,
}

/// A header row: bold, shaded, frozen, with column widths set.
fn header(ws: &mut Worksheet, cols: &[Col]) -> Result<(), XlsxError> {
    let bold = Format::new().set_bold().set_background_color(Color::RGB(0xEDEDED));
    for (i, c) in cols.iter().enumerate() {
        let col = i as u16;
        ws.write_string_with_format(0, col, c.header, &bold)?;
        ws.set_column_width(col, c.width)?;
    }
    ws.set_freeze_panes(1, 0)?;
    Ok(())
}

/// A filter over the header and `rows` data rows (none when there is no data).
fn filter(ws: &mut Worksheet, rows: usize, cols: usize) -> Result<(), XlsxError> {
    if rows > 0 {
        ws.autofilter(0, 0, rows as u32, (cols - 1) as u16)?;
    }
    Ok(())
}

fn status_label(code: i32) -> &'static str {
    match TaskStatus::from_proto(code) {
        Some(TaskStatus::Todo) => "To do",
        Some(TaskStatus::InProgress) => "In progress",
        Some(TaskStatus::Done) => "Done",
        Some(TaskStatus::Cancelled) => "Cancelled",
        None => "",
    }
}

fn priority_label(code: i32) -> &'static str {
    match TaskPriority::from_proto(code) {
        Some(TaskPriority::None) => "None",
        Some(TaskPriority::Low) => "Low",
        Some(TaskPriority::Medium) => "Medium",
        Some(TaskPriority::High) => "High",
        Some(TaskPriority::Urgent) => "Urgent",
        None => "",
    }
}

fn entity_label(code: i32) -> &'static str {
    match EntityType::from_proto(code) {
        Some(EntityType::Task) => "Task",
        Some(EntityType::Module) => "Module",
        Some(EntityType::Membership) => "Membership",
        Some(EntityType::Ownership) => "Ownership",
        Some(EntityType::Page) => "Page",
        Some(EntityType::Media) => "Media",
        None => "Other",
    }
}

fn action_label(code: i32) -> &'static str {
    [
        (ActivityAction::Created, "created"),
        (ActivityAction::Updated, "updated"),
        (ActivityAction::Deleted, "deleted"),
    ]
    .into_iter()
    .find(|(a, _)| a.to_proto() == code)
    .map_or("changed", |(_, l)| l)
}

fn task_sheet(
    wb: &mut Workbook,
    name: &str,
    items: &[dash_pb::MyTask],
    off: UtcOffset,
) -> Result<(), XlsxError> {
    let date = Format::new().set_num_format(DATE_FMT);
    let datetime = Format::new().set_num_format(DATETIME_FMT);
    let ws = wb.add_worksheet().set_name(name)?;
    let cols = [
        Col { header: "Title", width: 48.0 },
        Col { header: "Project", width: 24.0 },
        Col { header: "Module", width: 20.0 },
        Col { header: "Status", width: 14.0 },
        Col { header: "Priority", width: 12.0 },
        Col { header: "Start date", width: 14.0 },
        Col { header: "Due date", width: 14.0 },
        Col { header: "Completed at", width: 20.0 },
    ];
    header(ws, &cols)?;
    for (i, item) in items.iter().enumerate() {
        let r = i as u32 + 1;
        let Some(t) = &item.task else { continue };
        ws.write_string(r, 0, &t.title)?;
        ws.write_string(r, 1, &item.project_name)?;
        ws.write_string(r, 2, &item.module_name)?;
        ws.write_string(r, 3, status_label(t.status))?;
        ws.write_string(r, 4, priority_label(t.priority))?;
        if let Some(d) = t.start_date.as_deref().and_then(plain_date) {
            ws.write_datetime_with_format(r, 5, &d, &date)?;
        }
        if let Some(d) = t.due_date.as_deref().and_then(plain_date) {
            ws.write_datetime_with_format(r, 6, &d, &date)?;
        }
        if let Some(d) = t.completed_at.as_deref().and_then(|v| instant(v, off)) {
            ws.write_datetime_with_format(r, 7, &d, &datetime)?;
        }
    }
    filter(ws, items.len(), cols.len())
}

/// Build the workbook and return its bytes.
pub(crate) fn workbook(report: &pb::PeriodReport, meta: &Meta<'_>) -> Result<Vec<u8>, XlsxError> {
    let off = offset(meta.utc_offset_minutes);
    let mut wb = Workbook::new();
    let bold = Format::new().set_bold();
    let datetime = Format::new().set_num_format(DATETIME_FMT);
    let percent = Format::new().set_num_format("0%");

    // Summary — what this is, the period it covers, and when it was taken.
    {
        let ws = wb.add_worksheet().set_name("Summary")?;
        ws.set_column_width(0, 22.0)?;
        ws.set_column_width(1, 16.0)?;
        ws.set_column_width(2, 18.0)?;
        let kind = if meta.granularity == "weekly" { "Weekly" } else { "Monthly" };
        ws.write_string_with_format(0, 0, format!("{kind} report"), &Format::new().set_bold().set_font_size(14))?;
        ws.write_string(1, 0, "Period")?;
        ws.write_string(1, 1, meta.label)?;
        ws.write_string(2, 0, "Generated")?;
        if let Some(now) = wall_clock(OffsetDateTime::now_utc(), off) {
            ws.write_datetime_with_format(2, 1, &now, &datetime)?;
        }
        let mut r = 3;
        if !meta.by.is_empty() {
            ws.write_string(r, 0, "By")?;
            ws.write_string(r, 1, meta.by)?;
            r += 1;
        }
        if !meta.app_name.is_empty() {
            ws.write_string(r, 0, "App")?;
            ws.write_string(r, 1, meta.app_name)?;
            r += 1;
        }
        r += 1;
        ws.write_string_with_format(r, 0, "Metric", &bold)?;
        ws.write_string_with_format(r, 1, "This period", &bold)?;
        ws.write_string_with_format(r, 2, "Previous period", &bold)?;
        let t = report.totals.unwrap_or_default();
        let prev = report.prev_totals.as_ref();
        // Only the quantities of the window have a like-for-like previous value;
        // the backlog numbers are "now" under both windows.
        let rows: [(&str, u32, Option<u32>); 4] = [
            ("Completed", t.completed, prev.map(|p| p.completed)),
            ("Started", t.started, prev.map(|p| p.started)),
            ("Still open (now)", t.still_open, None),
            ("Overdue (now)", t.overdue, None),
        ];
        for (label, now, before) in rows {
            r += 1;
            ws.write_string(r, 0, label)?;
            ws.write_number(r, 1, now)?;
            if let Some(b) = before {
                ws.write_number(r, 2, b)?;
            }
        }
    }

    // Per project.
    {
        let ws = wb.add_worksheet().set_name("Per project")?;
        let cols = [
            Col { header: "Project", width: 32.0 },
            Col { header: "Completed", width: 12.0 },
            Col { header: "Started", width: 12.0 },
            Col { header: "Open now", width: 12.0 },
            Col { header: "Overdue now", width: 14.0 },
            Col { header: "Done", width: 10.0 },
            Col { header: "Total", width: 10.0 },
            Col { header: "Progress", width: 12.0 },
        ];
        header(ws, &cols)?;
        for (i, p) in report.per_project.iter().enumerate() {
            let r = i as u32 + 1;
            ws.write_string(r, 0, &p.project_name)?;
            ws.write_number(r, 1, p.completed)?;
            ws.write_number(r, 2, p.started)?;
            ws.write_number(r, 3, p.still_open)?;
            ws.write_number(r, 4, p.overdue)?;
            ws.write_number(r, 5, p.done_total)?;
            ws.write_number(r, 6, p.total)?;
            let progress = if p.total > 0 { f64::from(p.done_total) / f64::from(p.total) } else { 0.0 };
            ws.write_number_with_format(r, 7, progress, &percent)?;
        }
        filter(ws, report.per_project.len(), cols.len())?;
    }

    // Per member. A member whose user record is gone keeps its id.
    {
        let ws = wb.add_worksheet().set_name("Per member")?;
        let cols = [
            Col { header: "Member", width: 28.0 },
            Col { header: "Completed", width: 12.0 },
            Col { header: "Started", width: 12.0 },
            Col { header: "Open now", width: 12.0 },
            Col { header: "Overdue now", width: 14.0 },
        ];
        header(ws, &cols)?;
        for (i, m) in report.per_member.iter().enumerate() {
            let r = i as u32 + 1;
            let name = if m.user_name.is_empty() { format!("User {}", m.user_id) } else { m.user_name.clone() };
            ws.write_string(r, 0, name)?;
            ws.write_number(r, 1, m.completed)?;
            ws.write_number(r, 2, m.started)?;
            ws.write_number(r, 3, m.open_assigned)?;
            ws.write_number(r, 4, m.overdue_assigned)?;
        }
        filter(ws, report.per_member.len(), cols.len())?;
    }

    task_sheet(&mut wb, "Completed", &report.completed_tasks, off)?;
    task_sheet(&mut wb, "Overdue", &report.overdue_tasks, off)?;

    // Activity counts, then the total.
    {
        let ws = wb.add_worksheet().set_name("Activity")?;
        let cols = [
            Col { header: "Entity", width: 16.0 },
            Col { header: "Action", width: 14.0 },
            Col { header: "Count", width: 10.0 },
        ];
        header(ws, &cols)?;
        let n = report.activity_summary.len();
        for (i, a) in report.activity_summary.iter().enumerate() {
            let r = i as u32 + 1;
            ws.write_string(r, 0, entity_label(a.entity_type))?;
            ws.write_string(r, 1, action_label(a.action))?;
            ws.write_number(r, 2, a.count)?;
        }
        filter(ws, n, cols.len())?;
        let r = n as u32 + 1;
        ws.write_string_with_format(r, 0, "Total", &bold)?;
        ws.write_number_with_format(r, 2, report.activity_total, &bold)?;
    }

    wb.save_to_buffer()
}
