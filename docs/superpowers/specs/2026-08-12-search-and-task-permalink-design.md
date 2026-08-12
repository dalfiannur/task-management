# Global Search & Task Permalink — Flow Design

**Date:** 2026-08-12
**Status:** approved, ready for planning

## Goal

Make anything in the workspace reachable in two motions: type, then Enter.

Today a task can only be opened by first knowing which project and module holds
it, then clicking its row — there is no URL for a task, and no way to search
across projects at all. `SearchUsers` and `ListProjects`' `search` filter are the
only text search in the product, and both are substring matches over rows loaded
into memory.

This is the first of four sub-projects split out of a broader feature
discussion. It delivers the destination (a task URL) and the way to reach it
(global search). The remaining three — subtasks/dependencies, board & speed
features, team visibility — depend on this one and are specced separately.

## Scope

- A task detail dialog addressed by URL, openable from any project tab and from
  a cold deep link.
- A comment-level deep link, so a mention notification lands on the comment.
- `GetTask` — a single-task read, which does not exist yet.
- Full-text search over tasks, pages, comments, projects, and people, scoped to
  what the caller may see.
- A `Cmd/Ctrl+K` overlay as the only search surface.

Out of scope, deliberately:

- A `/search` results page, faceted filters, result paging.
- Typo tolerance (`pg_trgm`).
- Non-search command palette actions — those belong to the board & speed
  sub-project, which will extend this overlay rather than replace it.
- Indexing media, labels, or modules.
- A person profile page. See "People results refine, they do not navigate".

## Decision: the dialog is addressed by URL, not replaced by a page

`task-dialog.tsx` is already the de-facto task detail — form fields plus
`CommentThread`. It lacks only an address. So the dialog stays and becomes
URL-controlled: a `task` search param on the `_authed/projects/$projectId`
layout route, inherited by every tab beneath it.

Consequences worth naming: the browser Back button closes the dialog, the URL is
paste-able into chat, and the list or timeline behind the dialog stays on screen,
which is the context a full page would have thrown away.

Rejected alternatives:

- **A standalone `/tasks/$taskId` page.** More room for the subtask and
  dependency panels coming in the next sub-project, but it discards the
  surrounding project context and means building a second detail surface from
  scratch while the dialog still exists.
- **Both — dialog inside a project, page from a deep link.** The best fit per
  situation, at the cost of two surfaces that must be kept behaviourally
  identical forever.

## Decision: one denormalized `search_doc` table, written on the write path

Search must rank five different entity types against each other in one list and
must filter by project membership. Both requirements point at a single table.

Rejected alternatives:

- **A generated `tsvector` column on each component table.** Postgres would keep
  it fresh for free, but search then becomes five queries merged and re-ranked in
  Rust — the very pattern the recent `perf(activity)` and `perf(persistence)`
  commits moved away from. Worse, permission filtering needs `project_id` per
  row, and `CommentInfo` only carries `task_id`; resolving comment → task →
  module → project would cost extra queries *per result*.
- **The same table, filled by a periodic job.** Touches no existing handler, but
  a task created a minute ago would not be findable. For a tool that wants to be
  the single source of truth, that lag reads as a bug.

The accepted cost of the write-path approach is drift: a mutation path that
forgets to call the indexer leaves a stale row. `bin/reindex` is the remedy, and
the flow tests below cover every path that exists today.

## Decision: people results refine, they do not navigate

Person results were requested, but the app has no person destination — there is
no `/users/$id` route, and `my-tasks` is self-scoped by design
(`ListAssignedToMe`). Building a profile page here would front-run the team
visibility sub-project, where it belongs.

So selecting a person does not leave the overlay. It adds that person as a chip
in the query box and re-runs the search filtered to tasks assigned to them. This
is why `assignee_ids` appears in the schema below: one column and one clause
answer "what is Rina working on" without a new page.

## Backend contract

### Step zero

Confirm `SELECT cfgname FROM pg_ts_config` includes `indonesian`. Postgres 12+
normally ships the Snowball config, but this could not be verified from the dev
machine (no local `psql`, no running container). If it is absent, change one
constant to `simple`; everything else in this design holds, and only stemming
tolerance ("mereset" matching "reset") is lost.

The config name lives in exactly one place — a `const TS_CONFIG: &str` in the
persistence crate, interpolated into the DDL and the query — so the fallback is a
one-line change, not a search-and-replace.

### The index table

Owned by `persistence`, created in `Store::connect` immediately after
`pg.migrate()`. It is an index, not an entity, so it stays outside the Arke
component model and its table name is not `cmp_`-prefixed.

```sql
CREATE TABLE IF NOT EXISTS search_doc (
  kind         text NOT NULL,          -- task | page | comment | project | user
  entity_id    text NOT NULL,
  project_id   text,                   -- NULL = global (user)
  title        text NOT NULL DEFAULT '',
  body         text NOT NULL DEFAULT '',
  assignee_ids text[] NOT NULL DEFAULT '{}',
  updated_at   timestamptz NOT NULL DEFAULT now(),
  vec tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('indonesian', title), 'A') ||
        setweight(to_tsvector('indonesian', body),  'B')
      ) STORED,
  PRIMARY KEY (kind, entity_id)
);
CREATE INDEX IF NOT EXISTS search_doc_vec ON search_doc USING GIN (vec);
```

The `A`/`B` weighting is what makes cross-type ranking meaningful: a title hit
always outranks a body hit, regardless of which entity type it came from.

What goes into each row:

| kind | title | body | project_id | assignee_ids |
|---|---|---|---|---|
| `task` | `TaskInfo.title` | plain text of `TaskInfo.description` | resolved via module | `TaskAssignees.user_ids` |
| `page` | `PageInfo.title` | plain text of `PageInfo.content` | `PageInfo.project_id` | `{}` |
| `comment` | *(empty)* | plain text of `CommentInfo.content` | resolved via task → module | `{}` |
| `project` | project name | project description | the project's own id | `{}` |
| `user` | `UserProfile.display_name` | `UserPhone.value` | `NULL` | `{}` |

A comment has no title, so it is ranked purely on body weight — correct, since a
comment is body by nature.

### Store methods

`Store` gains four methods, all using bind parameters. This matters beyond
style: `Store::query` takes a raw SQL predicate string with no binding
(`persistence/src/lib.rs:93`), so routing user-supplied search text through it
would be an injection hole. The search path never touches that API.

```rust
pub async fn search(&self, q: &str, is_admin: bool, project_ids: &[String],
                    kinds: &[String], assignee_ids: &[String], limit: i64)
    -> Result<Vec<SearchRow>>;
pub async fn index_doc(&self, doc: SearchDoc) -> Result<()>;      // upsert
pub async fn deindex_doc(&self, kind: &str, entity_id: &str) -> Result<()>;
pub async fn deindex_project(&self, project_id: &str) -> Result<()>;
```

`deindex_project` exists because deleting a project must remove every document
belonging to it in one statement, not one round-trip per child.

### The query

One statement covers matching, permissions, type filter, assignee refinement,
ranking, snippet, and limit:

```sql
SELECT kind, entity_id, project_id, title,
       ts_headline('indonesian', body, q, 'MaxWords=18,MinWords=8') AS snippet,
       ts_rank(vec, q) AS score
FROM search_doc, websearch_to_tsquery('indonesian', $1) q
WHERE vec @@ q
  AND ($2::bool OR project_id IS NULL OR project_id = ANY($3))
  AND (cardinality($4::text[]) = 0 OR kind = ANY($4))
  AND (cardinality($5::text[]) = 0 OR assignee_ids && $5)
ORDER BY score DESC, updated_at DESC
LIMIT $6;
```

`$2` is `is_admin`. `$3` is the caller's project ids, from the existing
`member_project_ids` helper. `project_id IS NULL` admits person documents, which
are visible to every authenticated active user — consistent with `SearchUsers`
today.

The assignee clause needs no companion `kind = 'task'` filter: every non-task
row has an empty `assignee_ids`, and an empty array overlaps nothing, so an
active person chip narrows the result set to tasks on its own.

`websearch_to_tsquery` is chosen over `plainto_tsquery` because it accepts quoted
phrases and `-exclusion` from users who expect search-engine syntax, and it never
raises on malformed input — it yields an empty query instead, which the handler
treats as an empty search.

### Proto

New file `proto/search.proto`, package `sedjiwa.tasks.search.v1`. It must be
added to both lists in `crates/transport/build.rs` (compile + rerun-if-changed),
and `search_router` merged in `crates/app/src/router.rs`.

```proto
service SearchService {
  rpc Search(SearchRequest) returns (SearchResponse);
}

enum SearchKind {
  SEARCH_KIND_UNSPECIFIED = 0;
  TASK = 1;
  PAGE = 2;
  COMMENT = 3;
  PROJECT = 4;
  USER = 5;
}

message SearchRequest {
  string q = 1;
  repeated SearchKind kinds = 2;        // empty = all
  repeated string assignee_ids = 3;     // person-chip refinement
  uint32 limit = 4;                     // 0 → 20, capped at 50
}

message SearchResult {
  SearchKind kind = 1;
  string id = 2;                        // entity id
  string title = 3;
  string snippet = 4;                   // ts_headline, may contain <b> marks
  optional string project_id = 5;
  optional string project_name = 6;     // for the result subtitle
  optional string task_id = 7;          // comment results: the parent task
  float score = 8;
}

message SearchResponse { repeated SearchResult results = 1; }
```

`project_name` is resolved in the handler from the already-loaded project list,
not stored in `search_doc`, so a renamed project never shows a stale name.

For comment results `task_id` is needed to build the destination URL. It is not a
`search_doc` column: the handler resolves it by loading the comments it is about
to return, which is bounded by `limit`.

### `GetTask`

Added to `TaskService` in `work.proto`:

```proto
rpc GetTask(GetTaskRequest) returns (Task);
message GetTaskRequest { string id = 1; }
```

Member-gated through the existing task → module → project derivation. Without
it, the dialog can only render a task that some list already happens to have
loaded, which a cold deep link cannot guarantee.

### Keeping the index fresh

A `search::index` / `search::deindex` helper pair mirrors
`activity::recorder::record` exactly: called after a successful mutation,
best-effort, a failure logged via `tracing::warn!` and never propagated to the
triggering action.

Call sites, by service:

- `work/task_service.rs` — create, update, delete, move (move changes the module
  and therefore possibly the project).
- `pages/page_service.rs` — create, update, delete.
- `comments/comment_service.rs` — create, update, delete. Note this service does
  **not** currently call `record`, so these are new call sites rather than lines
  added beside existing ones.
- `projects/project_service.rs` — create, update, and delete (via
  `deindex_project`).
- `users/` — register, `UpdateMyProfile`, admin `CreateUser` / `UpdateUser` /
  `DeleteUser`. Status changes matter too: a suspended user must leave the index,
  matching `search_users`, which only returns Active users.

Rich text is projected to plain text before indexing so the tsvector holds
sentences, not markup. `domain::sanitize` gains `plain_text(input: &str) ->
String` beside the existing `clean_html`, built on the `ammonia` dependency
already present — an empty tag allowlist strips every tag while keeping the text.

### `bin/reindex`

A new binary beside `seed_admin` and `seed_user`: truncate `search_doc`, walk
every task, page, comment, project, and user, and rebuild. This is the answer to
the drift risk the write-path approach accepts. Run it after deploying this
feature — existing data has never been indexed — and any time the index is
suspect.

### Authorization

`Search` requires an authenticated, active caller. Admins skip the project
filter, exactly as `list_projects` does. Everyone else sees only documents whose
`project_id` is among their memberships, plus person documents.

Nothing in the response leaks an entity the caller could not already open:
`snippet` comes from a row that passed the same membership filter used by the
entity's own read RPC.

## Failure contract

| Situation | Behaviour |
|---|---|
| Search RPC fails | One error row inside the overlay; no retry; the app does not unmount anything. |
| Index write fails | Logged, mutation still succeeds. The index may lag; `bin/reindex` is the cure. This is the same contract activity logging already has. |
| Deep link to a deleted task, or one the caller cannot see | Dialog shows "task not found or you do not have access"; the `task` param is stripped from the URL. |
| `q` reduces to an empty tsquery (punctuation only) | Treated as an empty query — no results, no error. |
| `q` shorter than 2 characters | The client does not call; the overlay shows its hint text. |

## Frontend

### New feature `src/features/search/`

```
features/search/
├── api/hooks.ts        # useSearch(q, kinds, assigneeIds) — debounced 200ms,
│                       #   enabled at q.length >= 2
├── api/mappers.ts      # SearchResult proto → flat SearchHit
├── atoms/overlay.ts    # open state + the person chip
├── components/search-overlay.tsx
├── types.ts
└── index.ts
```

`cmdk` and `components/ui/command.tsx` are already in the repo (used by the label
and assignee pickers), so the overlay needs no new dependency.

Mounted once in `AppShell`, opened by a global `Cmd/Ctrl+K` handler. Results are
grouped by kind in a fixed order — Task, Page, Comment, Project, People — while
ordering *within* each group follows `score`. A fixed group order keeps the list
from reshuffling under the user's cursor as they type.

`snippet` carries `<b>` marks from `ts_headline`. It is rendered through the
existing sanitizing path rather than raw `dangerouslySetInnerHTML`.

Person rows render the name and avatar only — no snippet. Their indexed body is
the phone number, which is a matching aid, not something a result row should
display.

### Destinations

| Kind | Action |
|---|---|
| Task | `/projects/$projectId/all-tasks?task=<id>` |
| Comment | `/projects/$projectId/all-tasks?task=<taskId>&comment=<id>` |
| Page | `/projects/$projectId/pages?page=<id>` |
| Project | `/projects/$projectId` |
| Person | Overlay stays open; person becomes a chip; results refilter. |

### Routing changes

- `_authed/projects/$projectId.tsx` gains `validateSearch` for
  `{ task?: string; comment?: string }`, inherited by all tab routes.
- `all-tasks.tsx` renders `TaskDialog` when `task` is set, fetching through
  `GetTask` rather than reaching into list state, so a cold deep link works.
- `pages.tsx` gains a `page` search param. Its current selection mechanism must
  be read first and converted to URL state the same way — if it already holds the
  selected page in component state, that state is replaced, not duplicated.
- `notification-bell.tsx` navigates using the `taskId` and `commentId` the
  notification already carries. The comment at line 39 explaining why it can only
  open the project is deleted along with the limitation it describes.

## Verification

Backend: `crates/transport/tests/search_flow.rs`, following the existing
`*_flow.rs` pattern.

- A created task is findable; an updated title is findable by its new words and
  not its old ones; a deleted task disappears.
- The same three for pages and comments.
- A non-member searching a term that only exists in another project's task gets
  nothing.
- An admin gets it.
- Ranking: a task whose *title* matches outranks a task whose *description*
  matches the same term.
- `kinds` filter returns only the requested types.
- The assignee refinement returns only that person's tasks.
- Injection: `q = "'; DROP TABLE search_doc; --"` returns no rows, raises no
  error, and `search_doc` still exists afterwards.
- Reindex: truncate the table, run the rebuild, and the same queries return the
  same results.

A `GetTask` case goes in the existing `work_flow.rs`: a member reads a task by
id, a non-member gets permission denied, an unknown id gets not found.

Frontend has no test framework, so the gates stay `bun run tsc --noEmit`,
`bun run lint`, and `bun run build`, per CLAUDE.md. Regenerate Connect clients
with `./node_modules/.bin/buf generate` after the proto changes.
