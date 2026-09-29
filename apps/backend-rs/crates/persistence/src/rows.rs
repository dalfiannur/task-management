//! Domain component structs as rows of their `cmp_*` tables.
//!
//! The request paths do not use this: each domain's `record.rs` in `transport`
//! writes its tables with purpose-built SQL. This is for the places that need
//! to put arbitrary rows down — the seed binaries and test fixtures — through
//! [`crate::Store::create`] and [`crate::Store::attach`].

use domain::activity::ActivityInfo;
use domain::comment::CommentInfo;
use domain::label::LabelInfo;
use domain::media::{MediaFileInfo, TaskMediaLinkData};
use domain::module::{ModuleDescription, ModuleName, ModuleOrder, ModuleProjectRef};
use domain::notification::{NotificationInfo, NotificationRefs};
use domain::page::{PageAudit, PageInfo};
use domain::project::{
    ProjectDates, ProjectDescription, ProjectMembership, ProjectName, ProjectOwnerId,
    ProjectStatusComponent,
};
use domain::task::{
    TaskAssignees, TaskAudit, TaskBlockedBy, TaskInfo, TaskLabels, TaskModuleRef, TaskParent,
};
use domain::token::{TokenInfo, TokenOwner, TokenSecret, TokenUsage};
use domain::user::{AdminMark, UserPassword, UserPhone, UserProfile, UserStatusComponent};
use domain::HeartbeatAt;

/// One column value, carrying the SQL type it binds as.
#[derive(Debug, Clone)]
pub enum Val {
    Text(String),
    OptText(Option<String>),
    Int(i32),
    BigInt(i64),
    Bool(bool),
    /// A JSONB array of strings.
    TextList(Vec<String>),
}

impl Val {
    /// The placeholder for this value at position `n`, with its type spelled
    /// out so the statement never depends on how the parameter was inferred.
    pub(crate) fn placeholder(&self, n: usize) -> String {
        match self {
            Val::Text(_) | Val::OptText(_) => format!("${n}::text"),
            Val::Int(_) => format!("${n}::int4"),
            Val::BigInt(_) => format!("${n}::int8"),
            Val::Bool(_) => format!("${n}::bool"),
            Val::TextList(_) => format!("to_jsonb(${n}::text[])"),
        }
    }
}

pub trait IntoVal {
    fn into_val(self) -> Val;
}

impl IntoVal for String {
    fn into_val(self) -> Val {
        Val::Text(self)
    }
}
impl IntoVal for Option<String> {
    fn into_val(self) -> Val {
        Val::OptText(self)
    }
}
impl IntoVal for i32 {
    fn into_val(self) -> Val {
        Val::Int(self)
    }
}
impl IntoVal for i64 {
    fn into_val(self) -> Val {
        Val::BigInt(self)
    }
}
impl IntoVal for bool {
    fn into_val(self) -> Val {
        Val::Bool(self)
    }
}
impl IntoVal for Vec<String> {
    fn into_val(self) -> Val {
        Val::TextList(self)
    }
}

/// A struct that is one row of one component table.
pub trait Row {
    const TABLE: &'static str;
    fn into_values(self) -> Vec<(&'static str, Val)>;
}

/// One or more rows for the same new entity — a tuple of [`Row`]s.
pub trait Rows {
    fn into_rows(self) -> Vec<(&'static str, Vec<(&'static str, Val)>)>;
}

macro_rules! rows_tuple {
    ($($t:ident),+) => {
        impl<$($t: Row),+> Rows for ($($t,)+) {
            #[allow(non_snake_case)]
            fn into_rows(self) -> Vec<(&'static str, Vec<(&'static str, Val)>)> {
                let ($($t,)+) = self;
                vec![$(($t::TABLE, $t.into_values())),+]
            }
        }
    };
}
rows_tuple!(A);
rows_tuple!(A, B);
rows_tuple!(A, B, C);
rows_tuple!(A, B, C, D);
rows_tuple!(A, B, C, D, E);
rows_tuple!(A, B, C, D, E, F);

macro_rules! row {
    ($ty:ty, $table:literal, $($field:ident),+) => {
        impl Row for $ty {
            const TABLE: &'static str = $table;
            fn into_values(self) -> Vec<(&'static str, Val)> {
                vec![$((stringify!($field), self.$field.into_val())),+]
            }
        }
    };
}

row!(HeartbeatAt, "cmp_heartbeatat", ts);
row!(UserPhone, "cmp_userphone", value, verified);
row!(UserPassword, "cmp_userpassword", hash, changed_at);
row!(UserProfile, "cmp_userprofile", display_name, avatar_url, email);
row!(UserStatusComponent, "cmp_userstatuscomponent", status, created_at, last_login_at);
row!(AdminMark, "cmp_adminmark", granted_at);
row!(ProjectName, "cmp_projectname", value);
row!(ProjectDescription, "cmp_projectdescription", value);
row!(ProjectOwnerId, "cmp_projectownerid", value);
row!(ProjectStatusComponent, "cmp_projectstatuscomponent", value);
row!(ProjectDates, "cmp_projectdates", start_date, end_date);
row!(ProjectMembership, "cmp_projectmembership", project_id, user_id);
row!(ModuleName, "cmp_modulename", value);
row!(ModuleDescription, "cmp_moduledescription", value);
row!(ModuleProjectRef, "cmp_moduleprojectref", project_id);
row!(ModuleOrder, "cmp_moduleorder", value);
row!(TaskInfo, "cmp_taskinfo", title, description, status, priority, start_date, due_date, sort_order);
row!(TaskModuleRef, "cmp_taskmoduleref", module_id);
row!(TaskAssignees, "cmp_taskassignees", user_ids);
row!(TaskLabels, "cmp_tasklabels", label_ids);
row!(TaskParent, "cmp_taskparent", parent_id);
row!(TaskBlockedBy, "cmp_taskblockedby", task_ids);
row!(TaskAudit, "cmp_taskaudit", created_at, updated_at, completed_at, created_by);
row!(PageInfo, "cmp_pageinfo", project_id, title, icon, content, sort_order);
row!(PageAudit, "cmp_pageaudit", created_by, last_edited_by, created_at, updated_at);
row!(LabelInfo, "cmp_labelinfo", project_id, name, color);
row!(CommentInfo, "cmp_commentinfo", task_id, author_id, content, mentioned_user_ids, created_at, updated_at);
row!(MediaFileInfo, "cmp_mediafileinfo", project_id, file_name, original_file_name, mime_type, size, storage_key, uploaded_by, created_at, status);
row!(TaskMediaLinkData, "cmp_taskmedialinkdata", media_file_id, task_id, project_id);
row!(NotificationInfo, "cmp_notificationinfo", recipient_id, kind, actor_id, message, read, created_at);
row!(NotificationRefs, "cmp_notificationrefs", project_id, task_id, comment_id);
row!(ActivityInfo, "cmp_activityinfo", project_id, actor_id, entity_type, entity_id, action, summary, created_at);
row!(TokenSecret, "cmp_tokensecret", hash, preview);
row!(TokenOwner, "cmp_tokenowner", user_id);
row!(TokenInfo, "cmp_tokeninfo", name, created_at, expires_at);
row!(TokenUsage, "cmp_tokenusage", last_used_at);
