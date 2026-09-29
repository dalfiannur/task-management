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
