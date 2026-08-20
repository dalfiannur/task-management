//! ProjectSnapshot → the flat task CSV. Pure: no store, no I/O.

use std::collections::HashMap;

use super::model::ProjectSnapshot;

pub(crate) const CSV_HEADER: &str = "id,module,title,status,priority,assignees,labels,start_date,due_date,completed_at,parent_id,blocked_by,created_at,created_by";

/// RFC 4180: wrap in quotes when the value contains a comma, quote, CR or LF;
/// double any embedded quote.
fn field(v: &str) -> String {
    if v.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", v.replace('"', "\"\""))
    } else {
        v.to_string()
    }
}

fn names(ids: &[String], by_id: &HashMap<&str, &str>) -> String {
    ids.iter()
        .filter_map(|id| by_id.get(id.as_str()).copied())
        .collect::<Vec<_>>()
        .join("; ")
}

/// One row per task, in snapshot order. People and labels appear by name because
/// the destination is a spreadsheet a human reads; ids that resolve to nothing
/// are dropped rather than leaked as bare numbers.
pub(crate) fn tasks_csv(s: &ProjectSnapshot) -> String {
    let users: HashMap<&str, &str> = s.users.iter().map(|u| (u.id.as_str(), u.name.as_str())).collect();
    let labels: HashMap<&str, &str> = s.labels.iter().map(|l| (l.id.as_str(), l.name.as_str())).collect();
    let modules: HashMap<&str, &str> = s.modules.iter().map(|m| (m.id.as_str(), m.name.as_str())).collect();

    let mut out = String::from(CSV_HEADER);
    for t in &s.tasks {
        let cells = [
            t.id.clone(),
            modules.get(t.module_id.as_str()).copied().unwrap_or("").to_string(),
            t.title.clone(),
            t.status.clone(),
            t.priority.clone(),
            names(&t.assignee_ids, &users),
            names(&t.label_ids, &labels),
            t.start_date.clone().unwrap_or_default(),
            t.due_date.clone().unwrap_or_default(),
            t.completed_at.clone().unwrap_or_default(),
            t.parent_id.clone().unwrap_or_default(),
            t.blocked_by_ids.join("; "),
            t.created_at.clone(),
            users.get(t.created_by.as_str()).copied().unwrap_or("").to_string(),
        ];
        out.push('\n');
        out.push_str(&cells.iter().map(|c| field(c)).collect::<Vec<_>>().join(","));
    }
    out.push('\n');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::model::{LabelOut, ModuleOut, TaskOut, UserOut};

    fn task(id: &str, title: &str) -> TaskOut {
        TaskOut {
            id: id.into(),
            module_id: "10".into(),
            title: title.into(),
            description: String::new(),
            status: "todo".into(),
            priority: "high".into(),
            start_date: None,
            due_date: Some("2026-09-01".into()),
            completed_at: None,
            sort_order: 0,
            assignee_ids: vec!["1".into(), "2".into()],
            label_ids: vec!["7".into()],
            parent_id: None,
            blocked_by_ids: vec![],
            created_at: "2026-08-01T00:00:00Z".into(),
            updated_at: "2026-08-01T00:00:00Z".into(),
            created_by: "1".into(),
        }
    }

    fn snapshot(tasks: Vec<TaskOut>) -> ProjectSnapshot {
        ProjectSnapshot {
            users: vec![
                UserOut { id: "1".into(), name: "Rina".into() },
                UserOut { id: "2".into(), name: "Budi".into() },
            ],
            modules: vec![ModuleOut {
                id: "10".into(),
                name: "Persiapan".into(),
                description: String::new(),
                sort_order: 0,
            }],
            labels: vec![LabelOut { id: "7".into(), name: "urgent".into(), color: "#ff0000".into() }],
            tasks,
            ..Default::default()
        }
    }

    #[test]
    fn header_then_one_row_per_task_with_names_not_ids() {
        let out = tasks_csv(&snapshot(vec![task("100", "Pasang spanduk")]));
        let mut lines = out.lines();
        assert_eq!(lines.next().unwrap(), CSV_HEADER);
        let row = lines.next().unwrap();
        assert!(row.starts_with("100,Persiapan,Pasang spanduk,todo,high,"), "got: {row}");
        assert!(row.contains("Rina; Budi"), "assignees by name: {row}");
        assert!(row.contains("urgent"), "labels by name: {row}");
        assert!(lines.next().is_none(), "exactly one data row");
    }

    #[test]
    fn fields_with_commas_quotes_and_newlines_are_rfc4180_quoted() {
        let out = tasks_csv(&snapshot(vec![task("101", "Beli \"paku\", semen\ndan cat")]));
        let body = out.split_once('\n').unwrap().1;
        assert!(
            body.contains("\"Beli \"\"paku\"\", semen\ndan cat\""),
            "quotes doubled, field wrapped: {body}"
        );
    }

    #[test]
    fn unknown_ids_and_missing_dates_render_empty_not_raw_ids() {
        let mut t = task("102", "Yatim");
        t.assignee_ids = vec!["999".into()];
        t.label_ids = vec![];
        t.due_date = None;
        t.module_id = "404".into();
        let out = tasks_csv(&snapshot(vec![t]));
        let row = out.lines().nth(1).unwrap();
        assert!(row.starts_with("102,,Yatim,"), "unknown module → empty: {row}");
        assert!(!row.contains("999"), "unresolved user id must not leak: {row}");
    }
}
