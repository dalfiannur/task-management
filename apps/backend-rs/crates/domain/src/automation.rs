//! Automations: per-project "when → if → then" rules over tasks. Pure — the
//! types, their limits, and the matching the engine in `transport` runs.
//!
//! A rule is stored as JSON text (trigger, conditions, actions) and parsed
//! back into these types; anything that does not parse is treated as a broken
//! rule and never runs.

use serde::{Deserialize, Serialize};

pub const MAX_NAME: usize = 80;
pub const MAX_ACTIONS: usize = 5;
pub const MAX_MESSAGE: usize = 500;
pub const MAX_DUE_IN_DAYS: i32 = 30;
pub const MAX_SET_DUE_DAYS: i32 = 365;
/// Most actions one triggering change may cause, chains included.
pub const MAX_ACTIONS_PER_EVENT: usize = 10;
/// How deep an automation's own change may trigger further automations.
pub const MAX_DEPTH: u8 = 1;

/// Whether a rule runs, only reports what it would do, or is off.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Off,
    /// Match as when on, act on nothing, record what would have happened.
    Observe,
    On,
}

impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Observe => "observe",
            Self::On => "on",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "off" => Some(Self::Off),
            "observe" => Some(Self::Observe),
            "on" => Some(Self::On),
            _ => None,
        }
    }
    /// Proto `AutomationMode`: 1 off, 2 observe, 3 on.
    pub fn to_proto(self) -> i32 {
        match self {
            Self::Off => 1,
            Self::Observe => 2,
            Self::On => 3,
        }
    }
    pub fn from_proto(code: i32) -> Option<Self> {
        match code {
            1 => Some(Self::Off),
            2 => Some(Self::Observe),
            3 => Some(Self::On),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Trigger {
    /// The task moved between statuses; `None` matches any.
    StatusChanged { from: Option<String>, to: Option<String> },
    TaskCreated,
    /// Someone was added to the task's assignees.
    AssigneeAdded,
    /// The last open subtask of a task was completed (fires on the parent).
    SubtasksDone,
    /// An open task's due date passed. Time-based.
    Overdue,
    /// An open task is due within `days` days. Time-based.
    DueIn { days: i32 },
}

impl Trigger {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::StatusChanged { .. } => "status_changed",
            Self::TaskCreated => "task_created",
            Self::AssigneeAdded => "assignee_added",
            Self::SubtasksDone => "subtasks_done",
            Self::Overdue => "overdue",
            Self::DueIn { .. } => "due_in",
        }
    }

    /// Run by the periodic job rather than by a change.
    pub fn is_scheduled(&self) -> bool {
        matches!(self, Self::Overdue | Self::DueIn { .. })
    }
}

/// Every non-empty list must match (AND); within a list any value matches.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Conditions {
    #[serde(default)]
    pub priorities: Vec<String>,
    #[serde(default)]
    pub label_ids: Vec<String>,
    #[serde(default)]
    pub module_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotifyTarget {
    Assignees,
    Owner,
    User,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Action {
    SetStatus { status_id: String },
    SetPriority { priority: String },
    AddLabel { label_id: String },
    RemoveLabel { label_id: String },
    /// `user_id` empty = the task's creator.
    Assign { user_id: String },
    UnassignAll,
    MoveToModule { module_id: String },
    /// Due date = the day it runs + `days`.
    SetDueIn { days: i32 },
    Notify { target: NotifyTarget, user_id: String, message: String },
    Comment { text: String },
}

impl Action {
    /// Whether this action changes the task itself (and so may trigger more).
    pub fn edits_task(&self) -> bool {
        !matches!(self, Self::Notify { .. } | Self::Comment { .. })
    }
}

/// What the conditions are matched against: the task as it is now.
#[derive(Debug, Clone, Default)]
pub struct TaskFacts {
    pub priority: String,
    pub label_ids: Vec<String>,
    pub module_id: String,
}

pub fn matches(c: &Conditions, t: &TaskFacts) -> bool {
    (c.priorities.is_empty() || c.priorities.contains(&t.priority))
        && (c.label_ids.is_empty() || c.label_ids.iter().any(|l| t.label_ids.contains(l)))
        && (c.module_ids.is_empty() || c.module_ids.contains(&t.module_id))
}

/// The change a trigger is matched against.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Created,
    StatusChanged { from: String, to: String },
    AssigneeAdded,
    SubtasksDone,
}

pub fn fires_on(t: &Trigger, e: &Event) -> bool {
    match (t, e) {
        (Trigger::TaskCreated, Event::Created) => true,
        (Trigger::AssigneeAdded, Event::AssigneeAdded) => true,
        (Trigger::SubtasksDone, Event::SubtasksDone) => true,
        (Trigger::StatusChanged { from, to }, Event::StatusChanged { from: f, to: t }) => {
            from.as_ref().is_none_or(|x| x == f) && to.as_ref().is_none_or(|x| x == t)
        }
        _ => false,
    }
}

/// Whether a change made at `depth` (0 = a person's change) may trigger
/// rules: people's changes always; an automation's own change only up to
/// [`MAX_DEPTH`], and only through status changes and subtask completion —
/// the triggers a chain is useful for.
pub fn may_chain(depth: u8, e: &Event) -> bool {
    depth == 0
        || (depth <= MAX_DEPTH && matches!(e, Event::StatusChanged { .. } | Event::SubtasksDone))
}

pub fn name_ok(name: &str) -> bool {
    (1..=MAX_NAME).contains(&name.trim().chars().count())
}

/// Shape checks that need no database: counts, lengths, ranges.
pub fn shape_error(trigger: &Trigger, actions: &[Action]) -> Option<&'static str> {
    if actions.is_empty() {
        return Some("add at least one action");
    }
    if actions.len() > MAX_ACTIONS {
        return Some("at most 5 actions");
    }
    if let Trigger::DueIn { days } = trigger {
        if !(1..=MAX_DUE_IN_DAYS).contains(days) {
            return Some("'due in' must be 1 to 30 days");
        }
    }
    for a in actions {
        match a {
            Action::SetDueIn { days } if !(0..=MAX_SET_DUE_DAYS).contains(days) => {
                return Some("'set due date' must be 0 to 365 days ahead")
            }
            Action::Notify { message, .. } | Action::Comment { text: message }
                if message.trim().is_empty() || message.chars().count() > MAX_MESSAGE =>
            {
                return Some("messages must be 1 to 500 characters")
            }
            Action::Notify { target: NotifyTarget::User, user_id, .. } if user_id.is_empty() => {
                return Some("pick who to notify")
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conditions_and_across_lists_or_within() {
        let t = TaskFacts { priority: "high".into(), label_ids: vec!["1".into()], module_id: "m".into() };
        assert!(matches(&Conditions::default(), &t));
        let c = Conditions { priorities: vec!["low".into(), "high".into()], ..Default::default() };
        assert!(matches(&c, &t));
        let c = Conditions { priorities: vec!["high".into()], label_ids: vec!["2".into()], ..Default::default() };
        assert!(!matches(&c, &t));
        let c = Conditions { module_ids: vec!["m".into()], label_ids: vec!["2".into(), "1".into()], ..Default::default() };
        assert!(matches(&c, &t));
    }

    #[test]
    fn triggers() {
        let any = Trigger::StatusChanged { from: None, to: None };
        let to_done = Trigger::StatusChanged { from: None, to: Some("d".into()) };
        let e = Event::StatusChanged { from: "a".into(), to: "d".into() };
        assert!(fires_on(&any, &e) && fires_on(&to_done, &e));
        assert!(!fires_on(&Trigger::StatusChanged { from: Some("b".into()), to: None }, &e));
        assert!(!fires_on(&Trigger::TaskCreated, &e));
        assert!(fires_on(&Trigger::TaskCreated, &Event::Created));
        assert!(!fires_on(&Trigger::Overdue, &Event::Created));
    }

    #[test]
    fn modes_round_trip() {
        for m in [Mode::Off, Mode::Observe, Mode::On] {
            assert_eq!(Mode::parse(m.as_str()), Some(m));
            assert_eq!(Mode::from_proto(m.to_proto()), Some(m));
        }
        assert_eq!(Mode::from_proto(0), None);
    }

    #[test]
    fn chaining() {
        assert!(may_chain(0, &Event::Created));
        assert!(may_chain(1, &Event::StatusChanged { from: "a".into(), to: "b".into() }));
        assert!(!may_chain(1, &Event::AssigneeAdded));
        assert!(!may_chain(2, &Event::SubtasksDone));
    }

    #[test]
    fn json_round_trip() {
        let a = vec![
            Action::Notify { target: NotifyTarget::Owner, user_id: String::new(), message: "hi".into() },
            Action::UnassignAll,
        ];
        let s = serde_json::to_string(&a).unwrap();
        assert_eq!(serde_json::from_str::<Vec<Action>>(&s).unwrap(), a);
        let t: Trigger = serde_json::from_str(r#"{"kind":"due_in","days":3}"#).unwrap();
        assert_eq!(t, Trigger::DueIn { days: 3 });
        assert!(serde_json::from_str::<Trigger>(r#"{"kind":"nope"}"#).is_err());
    }

    #[test]
    fn shapes() {
        assert_eq!(shape_error(&Trigger::TaskCreated, &[]), Some("add at least one action"));
        assert!(shape_error(&Trigger::DueIn { days: 0 }, &[Action::UnassignAll]).is_some());
        assert!(shape_error(&Trigger::TaskCreated, &[Action::SetDueIn { days: 400 }]).is_some());
        assert!(shape_error(&Trigger::TaskCreated, &[Action::Comment { text: " ".into() }]).is_some());
        assert!(shape_error(
            &Trigger::TaskCreated,
            &[Action::Notify { target: NotifyTarget::User, user_id: String::new(), message: "x".into() }]
        )
        .is_some());
        assert!(shape_error(&Trigger::Overdue, &[Action::UnassignAll]).is_none());
        assert!(name_ok("Done → unassign") && !name_ok(" "));
    }
}
