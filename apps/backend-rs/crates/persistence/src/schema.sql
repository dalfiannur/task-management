-- Baseline schema: exactly what arke-postgres 0.13's `migrate()` created, so
-- running this on an existing database changes nothing. Every statement is
-- idempotent and it runs on every start (`Store::connect`).
--
-- `arke_entities` keeps its name: it allocates the pid every entity carries, a
-- sequence shared by every kind, and its `version` is bumped on each write.
-- Each `cmp_<component>` table is keyed by that pid and cascades on delete.
--
-- A change to this schema is a new statement appended below, never an edit of
-- one above (an edited CREATE ... IF NOT EXISTS does nothing on a database that
-- already has the table).

CREATE TABLE IF NOT EXISTS arke_entities (pid BIGSERIAL PRIMARY KEY, version BIGINT NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS cmp_activitychanges (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    changes JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS cmp_activityinfo (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_activityinfo_action ON cmp_activityinfo USING btree (action);
CREATE INDEX IF NOT EXISTS idx_cmp_activityinfo_actor_id ON cmp_activityinfo USING btree (actor_id);
CREATE INDEX IF NOT EXISTS idx_cmp_activityinfo_created_at ON cmp_activityinfo USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_cmp_activityinfo_entity_id ON cmp_activityinfo USING btree (entity_id);
CREATE INDEX IF NOT EXISTS idx_cmp_activityinfo_entity_type ON cmp_activityinfo USING btree (entity_type);
CREATE INDEX IF NOT EXISTS idx_cmp_activityinfo_project_id ON cmp_activityinfo USING btree (project_id);

CREATE TABLE IF NOT EXISTS cmp_adminmark (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    granted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cmp_commentinfo (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    content TEXT NOT NULL,
    mentioned_user_ids JSONB NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_commentinfo_author_id ON cmp_commentinfo USING btree (author_id);
CREATE INDEX IF NOT EXISTS idx_cmp_commentinfo_created_at ON cmp_commentinfo USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_cmp_commentinfo_task_id ON cmp_commentinfo USING btree (task_id);

CREATE TABLE IF NOT EXISTS cmp_heartbeatat (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    ts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cmp_labelinfo (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_labelinfo_name ON cmp_labelinfo USING btree (name);
CREATE INDEX IF NOT EXISTS idx_cmp_labelinfo_project_id ON cmp_labelinfo USING btree (project_id);

CREATE TABLE IF NOT EXISTS cmp_mediafileinfo (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    original_file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size BIGINT NOT NULL,
    storage_key TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_mediafileinfo_created_at ON cmp_mediafileinfo USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_cmp_mediafileinfo_mime_type ON cmp_mediafileinfo USING btree (mime_type);
CREATE INDEX IF NOT EXISTS idx_cmp_mediafileinfo_project_id ON cmp_mediafileinfo USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_cmp_mediafileinfo_uploaded_by ON cmp_mediafileinfo USING btree (uploaded_by);

CREATE TABLE IF NOT EXISTS cmp_moduledescription (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cmp_modulename (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cmp_moduleorder (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    value INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_moduleorder_value ON cmp_moduleorder USING btree (value);

CREATE TABLE IF NOT EXISTS cmp_moduleprojectref (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    project_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_moduleprojectref_project_id ON cmp_moduleprojectref USING btree (project_id);

CREATE TABLE IF NOT EXISTS cmp_notificationinfo (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    message TEXT NOT NULL,
    read BOOLEAN NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_notificationinfo_created_at ON cmp_notificationinfo USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_cmp_notificationinfo_kind ON cmp_notificationinfo USING btree (kind);
CREATE INDEX IF NOT EXISTS idx_cmp_notificationinfo_read ON cmp_notificationinfo USING btree (read);
CREATE INDEX IF NOT EXISTS idx_cmp_notificationinfo_recipient_id ON cmp_notificationinfo USING btree (recipient_id);

CREATE TABLE IF NOT EXISTS cmp_notificationrefs (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    project_id TEXT,
    task_id TEXT,
    comment_id TEXT
);

CREATE TABLE IF NOT EXISTS cmp_pageaudit (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    created_by TEXT NOT NULL,
    last_edited_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_pageaudit_created_at ON cmp_pageaudit USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_cmp_pageaudit_created_by ON cmp_pageaudit USING btree (created_by);

CREATE TABLE IF NOT EXISTS cmp_pageinfo (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    icon TEXT NOT NULL,
    content TEXT NOT NULL,
    sort_order INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_pageinfo_project_id ON cmp_pageinfo USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_cmp_pageinfo_sort_order ON cmp_pageinfo USING btree (sort_order);

CREATE TABLE IF NOT EXISTS cmp_projectcoreref (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_projectcoreref_value ON cmp_projectcoreref USING btree (value);

CREATE TABLE IF NOT EXISTS cmp_projectdates (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    start_date TEXT,
    end_date TEXT
);

CREATE TABLE IF NOT EXISTS cmp_projectdescription (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cmp_projectmembership (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_projectmembership_project_id ON cmp_projectmembership USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_cmp_projectmembership_user_id ON cmp_projectmembership USING btree (user_id);

CREATE TABLE IF NOT EXISTS cmp_projectname (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cmp_projectownerid (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_projectownerid_value ON cmp_projectownerid USING btree (value);

CREATE TABLE IF NOT EXISTS cmp_projectstatuscomponent (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cmp_taskassignees (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    user_ids JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS cmp_taskaudit (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cmp_taskblockedby (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    task_ids JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS cmp_taskinfo (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    start_date TEXT,
    due_date TEXT,
    sort_order INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_taskinfo_priority ON cmp_taskinfo USING btree (priority);
CREATE INDEX IF NOT EXISTS idx_cmp_taskinfo_sort_order ON cmp_taskinfo USING btree (sort_order);
CREATE INDEX IF NOT EXISTS idx_cmp_taskinfo_status ON cmp_taskinfo USING btree (status);

CREATE TABLE IF NOT EXISTS cmp_tasklabels (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    label_ids JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS cmp_taskmedialinkdata (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    media_file_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    project_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_taskmedialinkdata_media_file_id ON cmp_taskmedialinkdata USING btree (media_file_id);
CREATE INDEX IF NOT EXISTS idx_cmp_taskmedialinkdata_project_id ON cmp_taskmedialinkdata USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_cmp_taskmedialinkdata_task_id ON cmp_taskmedialinkdata USING btree (task_id);

CREATE TABLE IF NOT EXISTS cmp_taskmoduleref (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    module_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_taskmoduleref_module_id ON cmp_taskmoduleref USING btree (module_id);

CREATE TABLE IF NOT EXISTS cmp_taskparent (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    parent_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_taskparent_parent_id ON cmp_taskparent USING btree (parent_id);

CREATE TABLE IF NOT EXISTS cmp_tokeninfo (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT
);

CREATE TABLE IF NOT EXISTS cmp_tokenowner (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    user_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_tokenowner_user_id ON cmp_tokenowner USING btree (user_id);

CREATE TABLE IF NOT EXISTS cmp_tokensecret (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    hash TEXT NOT NULL,
    preview TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmp_tokensecret_hash ON cmp_tokensecret USING btree (hash);

CREATE TABLE IF NOT EXISTS cmp_tokenusage (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS cmp_userpassword (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    hash TEXT NOT NULL,
    changed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cmp_userphone (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    value TEXT NOT NULL,
    verified BOOLEAN NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmp_userphone_value ON cmp_userphone USING btree (value);

CREATE TABLE IF NOT EXISTS cmp_userprofile (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    avatar_url TEXT NOT NULL,
    email TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_userprofile_display_name ON cmp_userprofile USING btree (display_name);

CREATE TABLE IF NOT EXISTS cmp_userstatuscomponent (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cmp_userstatuscomponent_status ON cmp_userstatuscomponent USING btree (status);

-- A task's number within its project (#1, #2, …): assigned on create, never
-- reused while a higher one is live, kept across moves (they stay in-project).
CREATE TABLE IF NOT EXISTS cmp_tasknumber (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    value INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmp_tasknumber_project_value ON cmp_tasknumber USING btree (project_id, value);

-- Number every task that has none (tasks from before numbering, seeds and
-- fixtures), in creation order after the project's highest number.
INSERT INTO cmp_tasknumber (pid, project_id, value)
SELECT t.pid, t.project_id,
       COALESCE(mx.top, 0) + ROW_NUMBER() OVER (PARTITION BY t.project_id ORDER BY t.pid)
FROM (
    SELECT i.pid, p.project_id
    FROM cmp_taskinfo i
    JOIN cmp_taskmoduleref m ON m.pid = i.pid
    JOIN cmp_moduleprojectref p ON p.pid::text = m.module_id
    WHERE NOT EXISTS (SELECT 1 FROM cmp_tasknumber n WHERE n.pid = i.pid)
) t
LEFT JOIN (SELECT project_id, MAX(value) AS top FROM cmp_tasknumber GROUP BY project_id) mx
    ON mx.project_id = t.project_id;

-- A project's task statuses (its workflow): name, color and order are free —
-- `category` is one of todo / in_progress / done / cancelled and is what every
-- report, dashboard and `completed_at` rule reads. `cmp_taskinfo.status` keeps
-- the category of the task's current status, so those readers never join here.
CREATE TABLE IF NOT EXISTS cmp_taskstatusdef (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    category TEXT NOT NULL,
    sort_order INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_taskstatusdef_project_id ON cmp_taskstatusdef USING btree (project_id);

-- The task's status (a `cmp_taskstatusdef` pid). Absent = the project's first
-- status of the task's category (tasks from before custom statuses, fixtures).
CREATE TABLE IF NOT EXISTS cmp_taskstatusref (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    status_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_taskstatusref_status_id ON cmp_taskstatusref USING btree (status_id);

-- Give every project without statuses the four defaults. Pids are drawn up
-- front so the entity rows and the status rows share them in one statement.
WITH missing AS MATERIALIZED (
    SELECT nextval(pg_get_serial_sequence('arke_entities', 'pid')) AS pid,
           p.pid::text AS project_id, d.name, d.color, d.category, d.sort_order
    FROM cmp_projectname p
    CROSS JOIN (VALUES
        ('To Do', '#94a3b8', 'todo', 0),
        ('In Progress', '#f59e0b', 'in_progress', 1),
        ('Done', '#22c55e', 'done', 2),
        ('Cancelled', '#64748b', 'cancelled', 3)
    ) AS d(name, color, category, sort_order)
    WHERE NOT EXISTS (SELECT 1 FROM cmp_taskstatusdef s WHERE s.project_id = p.pid::text)
),
ent AS (
    INSERT INTO arke_entities (pid, version) SELECT pid, 0 FROM missing RETURNING pid
)
INSERT INTO cmp_taskstatusdef (pid, project_id, name, color, category, sort_order)
SELECT m.pid, m.project_id, m.name, m.color, m.category, m.sort_order
FROM missing m JOIN ent e ON e.pid = m.pid;

-- A task's estimate, in minutes. Absent = not estimated.
CREATE TABLE IF NOT EXISTS cmp_taskestimate (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    minutes INTEGER NOT NULL
);

-- A saved view of a project's Tasks tab: a named filter (URL query string,
-- verbatim) and layout. Personal to `owner_id` unless `shared`.
CREATE TABLE IF NOT EXISTS cmp_savedview (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    query TEXT NOT NULL,
    layout TEXT NOT NULL,
    shared BOOLEAN NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_savedview_project_id ON cmp_savedview USING btree (project_id);

-- Time spent on a task: a timer run (started_at … ended_at) or a hand-logged
-- amount. `running` = the timer is still going, at most one per user.
-- `work_date` is the author's local day the minutes count for.
CREATE TABLE IF NOT EXISTS cmp_timeentry (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    work_date TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    running BOOLEAN NOT NULL,
    minutes INTEGER NOT NULL,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_timeentry_task_id ON cmp_timeentry USING btree (task_id);
CREATE INDEX IF NOT EXISTS idx_cmp_timeentry_project_date ON cmp_timeentry USING btree (project_id, work_date);
CREATE INDEX IF NOT EXISTS idx_cmp_timeentry_user_date ON cmp_timeentry USING btree (user_id, work_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmp_timeentry_one_running ON cmp_timeentry USING btree (user_id) WHERE running;

-- Working days (bit 0 = Monday … bit 6 = Sunday) and, for a user, weekly
-- capacity in minutes. Attached to a project or a user entity. NULL = inherit
-- the global days or use the default capacity.
CREATE TABLE IF NOT EXISTS cmp_workcalendar (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    working_days INTEGER,
    weekly_minutes INTEGER
);

-- The one workspace-settings entity, holding the global working days.
CREATE TABLE IF NOT EXISTS cmp_workspacesettings (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    singleton BOOLEAN NOT NULL DEFAULT TRUE UNIQUE CHECK (singleton),
    working_days INTEGER NOT NULL
);

-- Marks a project as a template: hidden from the normal project list and
-- offered as a starting point when creating a project.
CREATE TABLE IF NOT EXISTS cmp_projecttemplatemark (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE
);

-- A reusable task within a project: its fields and the titles of its
-- subtasks. `label_ids` and `subtasks` are JSONB string arrays.
CREATE TABLE IF NOT EXISTS cmp_tasktemplate (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    priority TEXT NOT NULL,
    estimate_minutes INTEGER,
    label_ids JSONB NOT NULL,
    subtasks JSONB NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_tasktemplate_project_id ON cmp_tasktemplate USING btree (project_id);
-- An automation rule of a project. `trigger`, `conditions` and `actions` are
-- JSON text in the shapes of `domain::automation` (Trigger, Conditions,
-- a list of Action).
CREATE TABLE IF NOT EXISTS cmp_automation (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    enabled BOOLEAN NOT NULL,
    trigger_kind TEXT NOT NULL,
    trigger TEXT NOT NULL,
    conditions TEXT NOT NULL,
    actions TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_automation_project_id ON cmp_automation USING btree (project_id);

-- One run of a rule on a task: what ran, or why it stopped.
CREATE TABLE IF NOT EXISTS cmp_automationrun (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    automation_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    trigger_kind TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmp_automationrun_project ON cmp_automationrun USING btree (project_id, pid);
CREATE INDEX IF NOT EXISTS idx_cmp_automationrun_automation ON cmp_automationrun USING btree (automation_id, pid);

-- A time-based rule already ran for this task and due date: it runs once
-- per due date, and again only when the due date changes.
CREATE TABLE IF NOT EXISTS cmp_automationfired (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    automation_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    due_date TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmp_automationfired_key ON cmp_automationfired USING btree (automation_id, task_id, due_date);

-- Automation mode: off, observe (match and log what would happen, change
-- nothing) or on. Replaces `enabled`, which stays written in step (= on) so
-- the NOT NULL column keeps working.
ALTER TABLE cmp_automation ADD COLUMN IF NOT EXISTS mode TEXT;
UPDATE cmp_automation SET mode = CASE WHEN enabled THEN 'on' ELSE 'off' END WHERE mode IS NULL;
ALTER TABLE cmp_automation ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE cmp_automation SET updated_by = created_by WHERE updated_by IS NULL;

-- Which automation rule wrote a row (an activity entry, a comment, a
-- notification). Absent = a person did it.
CREATE TABLE IF NOT EXISTS cmp_automationsource (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    automation_id TEXT NOT NULL
);

-- A built-in identity that is not a person. `kind = 'automation'`: the actor
-- automation rules act as, scoped to the rule's project. It has a profile so
-- by-id lookups can name it, and no phone or password, so it can never sign
-- in. Created once, here.
CREATE TABLE IF NOT EXISTS cmp_systemtag (
    pid BIGINT PRIMARY KEY REFERENCES arke_entities(pid) ON DELETE CASCADE,
    kind TEXT NOT NULL UNIQUE
);
WITH missing AS MATERIALIZED (
    SELECT nextval(pg_get_serial_sequence('arke_entities', 'pid')) AS pid
    WHERE NOT EXISTS (SELECT 1 FROM cmp_systemtag WHERE kind = 'automation')
),
ent AS (
    INSERT INTO arke_entities (pid, version) SELECT pid, 0 FROM missing RETURNING pid
),
tag AS (
    INSERT INTO cmp_systemtag (pid, kind) SELECT pid, 'automation' FROM ent RETURNING pid
)
INSERT INTO cmp_userprofile (pid, display_name, avatar_url, email)
SELECT pid, 'Automation', '', '' FROM tag;

-- "Tasks assigned to these people" (workload's other-projects load, My
-- tasks, assignee filters) without scanning every task.
CREATE INDEX IF NOT EXISTS idx_cmp_taskassignees_user_ids ON cmp_taskassignees USING gin (user_ids);
