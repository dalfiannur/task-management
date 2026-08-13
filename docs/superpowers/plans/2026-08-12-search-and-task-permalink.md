# Global Search & Task Permalink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make any task, page, comment, project, or person reachable by typing into a `Cmd+K` overlay, and give every task a URL that can be deep-linked from a notification or pasted into chat.

**Architecture:** One denormalized `search_doc` table in Postgres holds a `tsvector` per indexed entity, written on the write path by a best-effort helper that mirrors `activity::recorder::record`. Search is a single SQL statement that does matching, permission filtering, ranking, snippet extraction, and limiting in the database. On the frontend, the existing task dialog stops being component state and becomes URL state via a `task` search param on the project layout route.

**Tech Stack:** Rust (axum + connectrpc-axum + sqlx + Arke ECS over Postgres), proto3/Connect, React 19 + TanStack Router/Query + connect-query + cmdk + Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-12-search-and-task-permalink-design.md`

---

## Before you start

**Set up the database env vars.** The Rust tests in this repo *silently skip* when their env var is missing — they print `skip: DATABASE_URL not set` and pass. A skipped test looks exactly like a passing test in the summary line. Every "expected: FAIL" step in this plan is meaningless if the tests are skipping.

```bash
cd apps/backend-rs
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/sedjiwa_tasks   # adjust to your local setup
export ARKE_TEST_DATABASE_URL=$DATABASE_URL
```

Verify the wiring before writing any code — this must print test output, not a skip line:

```bash
cargo test -p transport --test comment_flow -- --nocapture
```

Expected: `test comments_crud_mentions_and_guards ... ok` **without** a `skip: DATABASE_URL not set` line above it. If you see the skip line, fix your env before continuing.

**Never point `rustfmt` at a crate root** (`lib.rs`, `main.rs`). It follows `mod` declarations and reformats the whole module tree — aimed at `crates/transport/src/lib.rs` it rewrote 17 unrelated files, because this repo is not rustfmt-clean. Format leaf modules individually (`rustfmt --edition 2021 path/to/leaf.rs`) and hand-edit crate roots.

**Confirm the text search config exists** (spec step zero):

```bash
psql "$DATABASE_URL" -tAc "SELECT cfgname FROM pg_ts_config ORDER BY 1"
```

Expected: a list including `indonesian`. If `indonesian` is absent, use `"simple"` for the `TS_CONFIG` constant in Task 1 and note it in that task's commit message. Everything else in this plan is unchanged.

## File structure

**Backend — new files**

| File | Responsibility |
|---|---|
| `crates/persistence/src/search.rs` | `search_doc` DDL, `SearchDoc`/`SearchRow` types, the four bind-parameterized SQL methods |
| `crates/transport/src/search/mod.rs` | Module wiring, `kind` constants, shared helpers |
| `crates/transport/src/search/indexer.rs` | Best-effort `index` / `deindex` / `deindex_project` helpers |
| `crates/transport/src/search/search_service.rs` | `Search` RPC handler + `search_router` |
| `crates/transport/tests/search_flow.rs` | End-to-end flow tests |
| `crates/app/src/bin/reindex.rs` | Full index rebuild |
| `proto/search.proto` | `SearchService` contract |

**Backend — modified files**

`crates/persistence/src/lib.rs` (run the DDL, expose the module) · `crates/domain/src/sanitize.rs` (`plain_text`) · `crates/transport/src/lib.rs` (module + export) · `crates/transport/src/work/task_service.rs` · `crates/transport/src/work/mod.rs` · `crates/transport/src/pages/page_service.rs` · `crates/transport/src/comments/comment_service.rs` · `crates/transport/src/projects/project_service.rs` · `crates/transport/src/users/directory_service.rs` and `auth_service.rs` · `crates/transport/build.rs` · `crates/app/src/router.rs` · `crates/app/Cargo.toml` · `proto/work.proto` (`GetTask`)

**Frontend — new files**

| File | Responsibility |
|---|---|
| `src/features/search/types.ts` | Flat `SearchHit` type |
| `src/features/search/api/mappers.ts` | proto `SearchResult` → `SearchHit` |
| `src/features/search/api/hooks.ts` | `useSearch`, `useDebounced` |
| `src/features/search/atoms/overlay.ts` | Overlay open state + person chip |
| `src/features/search/components/search-overlay.tsx` | The `Cmd+K` overlay |
| `src/features/search/components/snippet.tsx` | Renders `ts_headline` output safely |
| `src/features/search/index.ts` | Barrel |

**Frontend — modified files**

`src/features/auth/components/app-shell.tsx` · `src/routes/_authed/projects/$projectId.tsx` · `src/features/tasks/components/all-tasks-tab.tsx` · `src/features/tasks/api/hooks.ts` · `src/features/comments/components/comment-thread.tsx` · `src/features/pages/components/pages-tab.tsx` · `src/routes/_authed/projects/$projectId/pages.tsx` · `src/features/notifications/components/notification-bell.tsx`

---

## Phase 1 — Index foundation

### Task 1: `search_doc` table and the persistence API

**Files:**
- Create: `apps/backend-rs/crates/persistence/src/search.rs`
- Modify: `apps/backend-rs/crates/persistence/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Append to `crates/persistence/src/search.rs` (create the file with just this test block for now — the module declaration comes in Step 3, so this will not compile yet; that is expected):

```rust
#[cfg(test)]
mod tests {
    use crate::search::SearchDoc;
    use crate::Store;

    async fn store() -> Option<Store> {
        let url = std::env::var("ARKE_TEST_DATABASE_URL").ok()?;
        Some(Store::connect(&url, |_| {}).await.unwrap())
    }

    fn doc(kind: &str, id: &str, title: &str, body: &str) -> SearchDoc {
        SearchDoc {
            kind: kind.into(),
            entity_id: id.into(),
            project_id: Some("p1".into()),
            title: title.into(),
            body: body.into(),
            assignee_ids: vec![],
        }
    }

    #[tokio::test]
    async fn index_search_and_deindex() {
        let Some(s) = store().await else {
            eprintln!("skip: ARKE_TEST_DATABASE_URL not set");
            return;
        };
        let uniq = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .to_string();
        let id = format!("t-{uniq}");
        let term = format!("zqx{uniq}"); // a term nothing else in the DB contains

        s.index_doc(doc("task", &id, &term, "body text"))
            .await
            .unwrap();
        let rows = s
            .search(&term, true, &[], &[], &[], 10)
            .await
            .unwrap();
        assert_eq!(rows.len(), 1, "indexed doc is findable");
        assert_eq!(rows[0].entity_id, id);
        assert!(rows[0].score > 0.0, "ranked");

        // Upsert replaces rather than duplicating.
        s.index_doc(doc("task", &id, &term, "different body"))
            .await
            .unwrap();
        let rows = s.search(&term, true, &[], &[], &[], 10).await.unwrap();
        assert_eq!(rows.len(), 1, "upsert, not insert");

        // Title beats body.
        let other = format!("t-other-{uniq}");
        s.index_doc(doc("task", &other, "unrelated title", &term))
            .await
            .unwrap();
        let rows = s.search(&term, true, &[], &[], &[], 10).await.unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].entity_id, id, "title hit outranks body hit");

        // Membership filter.
        let rows = s
            .search(&term, false, &["other-project".into()], &[], &[], 10)
            .await
            .unwrap();
        assert!(rows.is_empty(), "non-member sees nothing");

        // Injection attempt is inert.
        let rows = s
            .search("'; DROP TABLE search_doc; --", true, &[], &[], &[], 10)
            .await
            .unwrap();
        assert!(rows.is_empty());
        s.search(&term, true, &[], &[], &[], 10)
            .await
            .expect("search_doc still exists");

        s.deindex_doc("task", &id).await.unwrap();
        s.deindex_doc("task", &other).await.unwrap();
        let rows = s.search(&term, true, &[], &[], &[], 10).await.unwrap();
        assert!(rows.is_empty(), "deindexed");
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p persistence search 2>&1 | tail -20`
Expected: compile error — `file not found for module` / `cannot find function index_doc`.

- [ ] **Step 3: Write the implementation**

Put this **above** the `#[cfg(test)]` block in `crates/persistence/src/search.rs`:

```rust
//! Full-text search index. A denormalized document table, deliberately outside
//! the Arke component model: it is an index, not an entity, and it is the one
//! place where user-supplied text reaches SQL — so every method here binds its
//! parameters instead of formatting them into the statement.

use anyhow::Result;
use sqlx::{PgPool, Row};

/// Postgres text-search config. `simple` is the fallback when a deployment's
/// Postgres lacks the Snowball `indonesian` dictionary; it costs stemming
/// ("mereset" no longer matches "reset") and nothing else.
pub const TS_CONFIG: &str = "indonesian";

/// One indexable thing. `title` carries weight A, `body` weight B, so a title
/// hit outranks a body hit across every entity type.
#[derive(Debug, Clone)]
pub struct SearchDoc {
    pub kind: String,
    pub entity_id: String,
    /// `None` = visible to every authenticated user (people).
    pub project_id: Option<String>,
    pub title: String,
    pub body: String,
    /// Tasks only; empty elsewhere, which is what makes the person-chip filter
    /// narrow to tasks without a `kind` clause.
    pub assignee_ids: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct SearchRow {
    pub kind: String,
    pub entity_id: String,
    pub project_id: Option<String>,
    pub title: String,
    pub snippet: String,
    pub score: f32,
}

pub(crate) async fn migrate(pool: &PgPool) -> Result<()> {
    let ddl = format!(
        "CREATE TABLE IF NOT EXISTS search_doc (
           kind         text NOT NULL,
           entity_id    text NOT NULL,
           project_id   text,
           title        text NOT NULL DEFAULT '',
           body         text NOT NULL DEFAULT '',
           assignee_ids text[] NOT NULL DEFAULT '{{}}',
           updated_at   timestamptz NOT NULL DEFAULT now(),
           vec tsvector GENERATED ALWAYS AS (
                 setweight(to_tsvector('{cfg}', title), 'A') ||
                 setweight(to_tsvector('{cfg}', body),  'B')
               ) STORED,
           PRIMARY KEY (kind, entity_id)
         )",
        cfg = TS_CONFIG
    );
    sqlx::query(&ddl).execute(pool).await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS search_doc_vec ON search_doc USING GIN (vec)")
        .execute(pool)
        .await?;
    Ok(())
}

impl crate::Store {
    /// Upsert one document.
    pub async fn index_doc(&self, doc: SearchDoc) -> Result<()> {
        sqlx::query(
            "INSERT INTO search_doc
               (kind, entity_id, project_id, title, body, assignee_ids, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())
             ON CONFLICT (kind, entity_id) DO UPDATE SET
               project_id   = EXCLUDED.project_id,
               title        = EXCLUDED.title,
               body         = EXCLUDED.body,
               assignee_ids = EXCLUDED.assignee_ids,
               updated_at   = now()",
        )
        .bind(&doc.kind)
        .bind(&doc.entity_id)
        .bind(&doc.project_id)
        .bind(&doc.title)
        .bind(&doc.body)
        .bind(&doc.assignee_ids)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn deindex_doc(&self, kind: &str, entity_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM search_doc WHERE kind = $1 AND entity_id = $2")
            .bind(kind)
            .bind(entity_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Drop every document belonging to a project — one statement, not one
    /// round-trip per child, which matters on project delete.
    pub async fn deindex_project(&self, project_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM search_doc WHERE project_id = $1")
            .bind(project_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Erase the whole index (for `reindex`).
    pub async fn clear_index(&self) -> Result<()> {
        sqlx::query("TRUNCATE search_doc").execute(&self.pool).await?;
        Ok(())
    }

    /// Match, filter by permission, rank, snippet, and limit — in one statement.
    ///
    /// `is_admin` bypasses the membership filter, matching `list_projects`.
    /// Empty `kinds` / `assignee_ids` mean "no filter". `websearch_to_tsquery`
    /// never raises on malformed input; it yields an empty query, which matches
    /// nothing — that is what makes injection attempts inert here.
    pub async fn search(
        &self,
        q: &str,
        is_admin: bool,
        project_ids: &[String],
        kinds: &[String],
        assignee_ids: &[String],
        limit: i64,
    ) -> Result<Vec<SearchRow>> {
        let sql = format!(
            "SELECT kind, entity_id, project_id, title,
                    ts_headline('{cfg}', body, q, 'MaxWords=18,MinWords=8') AS snippet,
                    ts_rank(vec, q) AS score
             FROM search_doc, websearch_to_tsquery('{cfg}', $1) q
             WHERE vec @@ q
               AND ($2 OR project_id IS NULL OR project_id = ANY($3))
               AND (cardinality($4::text[]) = 0 OR kind = ANY($4))
               AND (cardinality($5::text[]) = 0 OR assignee_ids && $5)
             ORDER BY score DESC, updated_at DESC
             LIMIT $6",
            cfg = TS_CONFIG
        );
        let rows = sqlx::query(&sql)
            .bind(q)
            .bind(is_admin)
            .bind(project_ids)
            .bind(kinds)
            .bind(assignee_ids)
            .bind(limit)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .into_iter()
            .map(|r| SearchRow {
                kind: r.get("kind"),
                entity_id: r.get("entity_id"),
                project_id: r.get("project_id"),
                title: r.get("title"),
                snippet: r.get("snippet"),
                score: r.get("score"),
            })
            .collect())
    }
}
```

- [ ] **Step 4: Wire the module and run the DDL**

In `crates/persistence/src/lib.rs`, add the module declaration next to the other `use` lines at the top:

```rust
pub mod search;
pub use search::{SearchDoc, SearchRow};
```

And in `Store::connect`, immediately after `pg.migrate().await?;`:

```rust
        pg.migrate().await?;
        search::migrate(&pool).await?;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo test -p persistence search -- --nocapture`
Expected: `test search::tests::index_search_and_deindex ... ok`, with no `skip:` line.

- [ ] **Step 6: Commit**

```bash
git add apps/backend-rs/crates/persistence/src/search.rs apps/backend-rs/crates/persistence/src/lib.rs
git commit -m "feat(persistence): add the search_doc index and its bind-parameterized API"
```

---

### Task 2: `plain_text` projection for rich content

Tiptap content is HTML. Indexing it raw would put tag names into the tsvector and tag soup into snippets.

**Files:**
- Modify: `apps/backend-rs/crates/domain/src/sanitize.rs`

- [ ] **Step 1: Write the failing test**

Add to the existing `mod tests` block in `crates/domain/src/sanitize.rs`:

```rust
    #[test]
    fn plain_text_strips_tags_and_keeps_words() {
        let out = plain_text("<p>Perbaiki <strong>reset</strong> password</p><ul><li>satu</li></ul>");
        assert!(!out.contains('<'), "no markup left: {out}");
        assert!(out.contains("Perbaiki"));
        assert!(out.contains("reset"));
        assert!(out.contains("satu"));
    }

    #[test]
    fn plain_text_separates_adjacent_blocks() {
        // Without separation these would index as one nonsense token.
        let out = plain_text("<p>alpha</p><p>beta</p>");
        assert!(out.contains("alpha beta") || out.contains("alpha\nbeta"), "got: {out}");
    }

    #[test]
    fn plain_text_drops_script_content() {
        let out = plain_text("<p>hi</p><script>alert(1)</script>");
        assert!(!out.contains("alert"));
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p domain plain_text`
Expected: FAIL — `cannot find function plain_text in this scope`.

- [ ] **Step 3: Write the implementation**

Add to `crates/domain/src/sanitize.rs`, after `clean_html`:

```rust
/// Project rich-text HTML down to the words inside it, for full-text indexing.
///
/// Block tags become spaces first, so `<p>a</p><p>b</p>` indexes as two tokens
/// rather than one. `ammonia` with an empty tag allowlist then removes every
/// remaining tag while keeping its text, and drops `script`/`style` content
/// entirely.
pub fn plain_text(input: &str) -> String {
    let spaced = input
        .replace("</p>", "</p> ")
        .replace("<br>", " ")
        .replace("<br/>", " ")
        .replace("<br />", " ")
        .replace("</li>", "</li> ")
        .replace("</h1>", "</h1> ")
        .replace("</h2>", "</h2> ")
        .replace("</h3>", "</h3> ")
        .replace("</h4>", "</h4> ")
        .replace("</h5>", "</h5> ")
        .replace("</h6>", "</h6> ")
        .replace("</blockquote>", "</blockquote> ")
        .replace("</pre>", "</pre> ");
    let stripped = Builder::default()
        .tags(HashSet::new())
        .clean_content_tags(["script", "style"].into_iter().collect())
        .clean(&spaced)
        .to_string();
    // Ammonia escapes bare text entities; collapse whitespace so the tsvector
    // and any snippet stay tidy.
    stripped.split_whitespace().collect::<Vec<_>>().join(" ")
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test -p domain plain_text`
Expected: three tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/crates/domain/src/sanitize.rs
git commit -m "feat(domain): project rich-text HTML to plain text for indexing"
```

---

> **Execution note (added during implementation):** Task 9 is built immediately after Task 3, before Tasks 4–8. As originally ordered, each of Tasks 4–8 wrote a flow test that could not even compile until Task 9 introduced `search_router`, so five tasks would accumulate unrunnable tests that all went green at once — burying the feedback for whichever one was actually broken. Task 9 depends on nothing in 4–8 (it needs only the proto, `Store::search`, and existing helpers), so moving it up makes each write-path task verifiable on its own the moment it lands. Task numbering below is unchanged; only the order of execution differs.

## Phase 2 — Write path

### Task 3: The indexer helper

Mirrors `crates/transport/src/activity/recorder.rs`: called after a successful mutation, failures logged and never propagated.

**Files:**
- Create: `apps/backend-rs/crates/transport/src/search/mod.rs`
- Create: `apps/backend-rs/crates/transport/src/search/indexer.rs`
- Modify: `apps/backend-rs/crates/transport/src/lib.rs`

- [ ] **Step 1: Write `indexer.rs`**

```rust
//! The shared index helpers other services call after a successful mutation.
//! Best-effort, exactly like `activity::record`: a failure is logged, never
//! propagated to the triggering action. The index may lag; `bin/reindex` is the
//! remedy.

use persistence::{SearchDoc, Store};

/// Document kinds. These strings are the contract between the indexer, the
/// search handler, and the proto enum — change them in all three or nowhere.
pub(crate) mod kind {
    pub const TASK: &str = "task";
    pub const PAGE: &str = "page";
    pub const COMMENT: &str = "comment";
    pub const PROJECT: &str = "project";
    pub const USER: &str = "user";
}

pub(crate) async fn index(store: &Store, doc: SearchDoc) {
    let kind = doc.kind.clone();
    let id = doc.entity_id.clone();
    if let Err(e) = store.index_doc(doc).await {
        tracing::warn!(error = %e, kind = %kind, id = %id, "failed to index document");
    }
}

pub(crate) async fn deindex(store: &Store, kind: &str, entity_id: &str) {
    if let Err(e) = store.deindex_doc(kind, entity_id).await {
        tracing::warn!(error = %e, kind = %kind, id = %entity_id, "failed to deindex document");
    }
}

pub(crate) async fn deindex_project(store: &Store, project_id: &str) {
    if let Err(e) = store.deindex_project(project_id).await {
        tracing::warn!(error = %e, project = %project_id, "failed to deindex project");
    }
}

/// Build a task document. `body` is the description projected to plain text.
pub(crate) fn task_doc(
    id: &str,
    project_id: &str,
    title: &str,
    description: &str,
    assignee_ids: Vec<String>,
) -> SearchDoc {
    SearchDoc {
        kind: kind::TASK.into(),
        entity_id: id.into(),
        project_id: Some(project_id.into()),
        title: title.into(),
        body: domain::sanitize::plain_text(description),
        assignee_ids,
    }
}

pub(crate) fn page_doc(id: &str, project_id: &str, title: &str, content: &str) -> SearchDoc {
    SearchDoc {
        kind: kind::PAGE.into(),
        entity_id: id.into(),
        project_id: Some(project_id.into()),
        title: title.into(),
        body: domain::sanitize::plain_text(content),
        assignee_ids: vec![],
    }
}

/// A comment has no title, so it ranks purely on body weight — correct, since a
/// comment is body by nature.
pub(crate) fn comment_doc(id: &str, project_id: &str, content: &str) -> SearchDoc {
    SearchDoc {
        kind: kind::COMMENT.into(),
        entity_id: id.into(),
        project_id: Some(project_id.into()),
        title: String::new(),
        body: domain::sanitize::plain_text(content),
        assignee_ids: vec![],
    }
}

pub(crate) fn project_doc(id: &str, name: &str, description: &str) -> SearchDoc {
    SearchDoc {
        kind: kind::PROJECT.into(),
        entity_id: id.into(),
        // A project's own id, so the membership filter covers it like any child.
        project_id: Some(id.into()),
        title: name.into(),
        body: domain::sanitize::plain_text(description),
        assignee_ids: vec![],
    }
}

/// People are global: `project_id` is `None`, so they pass the membership
/// filter for every authenticated caller — matching `search_users` today.
pub(crate) fn user_doc(id: &str, display_name: &str, phone: &str) -> SearchDoc {
    SearchDoc {
        kind: kind::USER.into(),
        entity_id: id.into(),
        project_id: None,
        title: display_name.into(),
        body: phone.into(),
        assignee_ids: vec![],
    }
}
```

- [ ] **Step 2: Write `mod.rs`**

```rust
//! Search: the write-path indexer other services call, plus the read-path
//! `SearchService`. See docs/…/2026-08-12-search-and-task-permalink-design.md.

mod indexer;
mod search_service;

pub use search_service::search_router;

pub(crate) use indexer::{
    comment_doc, deindex, deindex_project, index, kind, page_doc, project_doc, task_doc, user_doc,
};
```

Note `search_service` does not exist yet — Task 9 creates it. Until then, comment out the `mod search_service;` and `pub use search_service::search_router;` lines so the crate compiles.

- [ ] **Step 3: Register the module**

In `crates/transport/src/lib.rs`, add `mod search;` to the module list (alphabetical, between `projects` and `users`). Leave the `pub use` for `search_router` until Task 9.

- [ ] **Step 4: Verify it compiles**

Run: `cargo check -p transport`
Expected: success. Dead-code warnings for the unused `index`/`doc` builders are expected at this point and disappear in Task 4.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/crates/transport/src/search apps/backend-rs/crates/transport/src/lib.rs
git commit -m "feat(search): add the best-effort index helpers"
```

---

### Task 4: Index tasks

**Files:**
- Modify: `apps/backend-rs/crates/transport/src/work/task_service.rs`
- Test: `apps/backend-rs/crates/transport/tests/search_flow.rs` (create)

- [ ] **Step 1: Write the failing test**

Create `crates/transport/tests/search_flow.rs`. This harness is copied from `comment_flow.rs` (the pattern every `*_flow.rs` uses) with the search router merged in:

```rust
//! End-to-end search over the real Connect routers + Postgres.
//! Skipped unless `DATABASE_URL` is set. Unique terms so reruns stay isolated.

use std::sync::Arc;

use auth::{sign_jwt, verify_jwt};
use axum::body::{to_bytes, Body};
use axum::extract::Request;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::StatusCode;
use axum::middleware::{from_fn, Next};
use axum::response::Response;
use axum::Router;
use domain::user::{UserPassword, UserPhone, UserProfile, UserStatusComponent};
use persistence::Store;
use serde_json::{json, Value};
use tower::ServiceExt;

const SECRET: &str = "test-secret";
const PROJECT: &str = "/sedjiwa.tasks.project.v1.ProjectService";
const MODULE: &str = "/sedjiwa.tasks.work.v1.ModuleService";
const TASK: &str = "/sedjiwa.tasks.work.v1.TaskService";
const COMMENT: &str = "/sedjiwa.tasks.comment.v1.CommentService";
const PAGE: &str = "/sedjiwa.tasks.page.v1.PageService";
const SEARCH: &str = "/sedjiwa.tasks.search.v1.SearchService";

fn uniq() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos().to_string()
}

/// A nonsense term no other row in the dev database can contain.
fn term() -> String {
    format!("zqx{}", uniq())
}

async fn auth_mw(mut req: Request, next: Next) -> Response {
    if let Some(tok) = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
    {
        if let Ok(u) = verify_jwt(tok.trim(), SECRET) {
            req.extensions_mut().insert(u);
        }
    }
    next.run(req).await
}

async fn setup() -> Option<(Router, Arc<Store>)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let store = Arc::new(Store::connect(&url, domain::register_all).await.unwrap());
    let router = transport::project_router(store.clone())
        .merge(transport::module_router(store.clone()))
        .merge(transport::task_router(store.clone()))
        .merge(transport::comment_router(store.clone()))
        .merge(transport::page_router(store.clone()))
        .merge(transport::search_router(store.clone()))
        .layer(from_fn(auth_mw));
    Some((router, store))
}

fn token(sub: &str) -> String {
    sign_jwt(SECRET, sub, &["projects:create".to_string()], 9_999_999_999).unwrap()
}

async fn call(router: &Router, path: &str, token: Option<&str>, body: Value) -> (StatusCode, Value) {
    let mut b = Request::builder().method("POST").uri(path).header(CONTENT_TYPE, "application/json");
    if let Some(t) = token {
        b = b.header(AUTHORIZATION, format!("Bearer {t}"));
    }
    let req = b.body(Body::from(body.to_string())).unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

async fn ok(router: &Router, path: &str, tok: &str, body: Value) -> Value {
    let (st, v) = call(router, path, Some(tok), body).await;
    assert_eq!(st, StatusCode::OK, "{path}: {v}");
    v
}

async fn mk_user(store: &Store) -> String {
    let now = "2026-01-01T00:00:00Z".to_string();
    store
        .create((
            UserPhone { value: format!("s{}", uniq()), verified: true },
            UserPassword { hash: "x".into(), changed_at: now.clone() },
            UserProfile { display_name: "S".into(), avatar_url: String::new(), email: String::new() },
            UserStatusComponent { status: "active".into(), created_at: now, last_login_at: None },
        ))
        .await
        .unwrap()
        .to_string()
}

async fn project_with(router: &Router, owner: &str, members: &[&str]) -> String {
    let p = ok(router, &format!("{PROJECT}/CreateProject"), &token(owner), json!({ "name": format!("P{}", uniq()) })).await;
    let id = p["id"].as_str().unwrap().to_string();
    for m in members {
        ok(router, &format!("{PROJECT}/AddProjectMember"), &token(owner), json!({ "projectId": id, "userId": m })).await;
    }
    id
}

async fn module_in(router: &Router, owner_tok: &str, project: &str) -> String {
    ok(router, &format!("{MODULE}/CreateModule"), owner_tok, json!({ "projectId": project, "name": "M" }))
        .await["id"].as_str().unwrap().to_string()
}

/// Search as `tok`, returning the results array.
async fn find(router: &Router, tok: &str, q: &str) -> Vec<Value> {
    let v = ok(router, &format!("{SEARCH}/Search"), tok, json!({ "q": q })).await;
    v["results"].as_array().cloned().unwrap_or_default()
}

#[tokio::test]
async fn task_is_indexed_on_create_update_and_delete() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let outsider = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[]).await;
    let to = token(&owner);
    let m = module_in(&router, &to, &pid).await;

    let t1 = term();
    let task = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({
        "moduleId": m, "title": format!("Perbaiki {t1}"), "description": "<p>catatan</p>"
    })).await["id"].as_str().unwrap().to_string();

    let hits = find(&router, &to, &t1).await;
    assert_eq!(hits.len(), 1, "created task is findable: {hits:?}");
    assert_eq!(hits[0]["kind"], "TASK");
    assert_eq!(hits[0]["id"], task);
    assert_eq!(hits[0]["projectId"], pid);

    // A non-member of the project finds nothing.
    let hits = find(&router, &token(&outsider), &t1).await;
    assert!(hits.is_empty(), "non-member sees nothing: {hits:?}");

    // An admin bypasses the membership filter, matching `list_projects`.
    let admin_tok = auth::sign_jwt(SECRET, &outsider, &["*".to_string()], 9_999_999_999).unwrap();
    let hits = find(&router, &admin_tok, &t1).await;
    assert_eq!(hits.len(), 1, "admin sees every project: {hits:?}");

    // Update: findable by the new term, not the old one.
    let t2 = term();
    ok(&router, &format!("{TASK}/UpdateTask"), &to, json!({ "id": task, "title": format!("Ganti {t2}") })).await;
    assert_eq!(find(&router, &to, &t2).await.len(), 1, "new title indexed");
    assert!(find(&router, &to, &t1).await.is_empty(), "old title gone");

    // Delete removes the document.
    ok(&router, &format!("{TASK}/DeleteTask"), &to, json!({ "id": task })).await;
    assert!(find(&router, &to, &t2).await.is_empty(), "deleted task gone");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p transport --test search_flow -- --nocapture`
Expected: compile error — `cannot find function search_router in crate transport`. That is the correct failure at this point; Task 9 adds the read path. Leave this test red and continue — Tasks 4 through 8 build the write path it exercises.

- [ ] **Step 3: Add the index calls to `task_service.rs`**

Add to the imports:

```rust
use crate::search::{deindex, index, kind, task_doc};
```

In `create_task`, directly after the `record(...)` call and before `let t = require_task(&store, pid).await?;`:

```rust
    index(
        &store,
        task_doc(
            &pid.to_string(),
            &project_id,
            title,
            &description_for_index,
            assignees.clone(),
        ),
    )
    .await;
```

`description_for_index` does not exist yet. In the same function, the description is sanitized inline inside the `store.create((...))` call. Hoist it so both uses share one value — replace:

```rust
                description: domain::sanitize::clean_html(&r.description.unwrap_or_default()),
```

with a binding declared just above `let pid = store` :

```rust
    let description_for_index = domain::sanitize::clean_html(&r.description.unwrap_or_default());
```

and inside the bundle use:

```rust
                description: description_for_index.clone(),
```

In `update_task`, after its `record(...)` call, re-index from the freshly loaded record. `update_task` already ends with `let t = require_task(&store, pid).await?;` — put the index call after that line and before the `Ok(ConnectResponse::new(...))`:

```rust
    index(
        &store,
        task_doc(
            &pid.to_string(),
            &project_id,
            &t.title,
            &t.description,
            t.assignee_ids.clone(),
        ),
    )
    .await;
```

In `delete_task`, after its `record(...)` call:

```rust
    deindex(&store, kind::TASK, &pid.to_string()).await;
```

In `move_task`, after the store update and after `let t = require_task(&store, pid).await?;` — a move can change the module and therefore the owning project, so the document's `project_id` must be refreshed:

```rust
    let moved_project = super::task_project_id(&store, &pid.to_string())
        .await
        .map_err(internal)?
        .unwrap_or_default();
    index(
        &store,
        task_doc(
            &pid.to_string(),
            &moved_project,
            &t.title,
            &t.description,
            t.assignee_ids.clone(),
        ),
    )
    .await;
```

If `project_id`, `title`, or `assignees` are named differently in a given handler, read the surrounding lines and use the local names — do not introduce new lookups.

- [ ] **Step 4: Verify it compiles**

Run: `cargo check -p transport`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/crates/transport/src/work/task_service.rs apps/backend-rs/crates/transport/tests/search_flow.rs
git commit -m "feat(search): index tasks on create, update, move, and delete"
```

---

### Task 5: Index pages

**Files:**
- Modify: `apps/backend-rs/crates/transport/src/pages/page_service.rs`

- [ ] **Step 1: Add the failing test**

Append to `crates/transport/tests/search_flow.rs`:

```rust
#[tokio::test]
async fn page_is_indexed_on_create_update_and_delete() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[]).await;
    let to = token(&owner);

    let page = ok(&router, &format!("{PAGE}/CreatePage"), &to, json!({ "projectId": pid })).await["id"]
        .as_str().unwrap().to_string();

    let t = term();
    ok(&router, &format!("{PAGE}/UpdatePage"), &to, json!({
        "id": page, "title": format!("Alur {t}"), "content": "<p>langkah pertama</p>"
    })).await;

    let hits = find(&router, &to, &t).await;
    assert_eq!(hits.len(), 1, "page findable by title: {hits:?}");
    assert_eq!(hits[0]["kind"], "PAGE");
    assert_eq!(hits[0]["id"], page);

    // Body is indexed as words, not markup.
    let t2 = term();
    ok(&router, &format!("{PAGE}/UpdatePage"), &to, json!({
        "id": page, "content": format!("<p>isi {t2} di sini</p>")
    })).await;
    assert_eq!(find(&router, &to, &t2).await.len(), 1, "page body indexed");

    ok(&router, &format!("{PAGE}/DeletePage"), &to, json!({ "id": page })).await;
    assert!(find(&router, &to, &t2).await.is_empty(), "deleted page gone");
}
```

- [ ] **Step 2: Run to confirm it fails for the right reason**

Run: `cargo test -p transport --test search_flow`
Expected: still the `search_router` compile error from Task 4. Correct.

- [ ] **Step 3: Add the index calls**

In `crates/transport/src/pages/page_service.rs`, add to the imports:

```rust
use crate::search::{deindex, index, kind, page_doc};
```

All three handlers already reload the record into a local `p` (`let p = require_page(&store, pid).await?;`) before calling `record(...)`, so the same line works in `create_page` and `update_page`. Insert it directly after each `record(...).await;` and before the closing `Ok(ConnectResponse::new(...))`:

```rust
    index(&store, page_doc(&pid.to_string(), &p.project_id, &p.title, &p.content)).await;
```

In `delete_page`, after its `record(...).await;`:

```rust
    deindex(&store, kind::PAGE, &pid.to_string()).await;
```

In `delete_page`, `p` is the record loaded *before* the delete, which is what makes `p.project_id` available for the guard — do not try to reload it after the delete.

- [ ] **Step 4: Verify it compiles**

Run: `cargo check -p transport`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/crates/transport/src/pages/page_service.rs apps/backend-rs/crates/transport/tests/search_flow.rs
git commit -m "feat(search): index pages"
```

---

### Task 6: Index comments

`comment_service.rs` does **not** call `activity::record` today, so these are new call sites rather than lines added beside existing ones. The owning project is already resolved at the top of each handler by `task_project(&store, &r.task_id)`.

**Files:**
- Modify: `apps/backend-rs/crates/transport/src/comments/comment_service.rs`

- [ ] **Step 1: Add the failing test**

Append to `crates/transport/tests/search_flow.rs`:

```rust
#[tokio::test]
async fn comment_is_indexed_and_carries_its_task() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let outsider = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[]).await;
    let to = token(&owner);
    let m = module_in(&router, &to, &pid).await;
    let task = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m, "title": "T" }))
        .await["id"].as_str().unwrap().to_string();

    let t = term();
    let cid = ok(&router, &format!("{COMMENT}/CreateComment"), &to, json!({
        "taskId": task, "content": format!("<p>gagal karena {t}</p>")
    })).await["id"].as_str().unwrap().to_string();

    let hits = find(&router, &to, &t).await;
    assert_eq!(hits.len(), 1, "comment findable: {hits:?}");
    assert_eq!(hits[0]["kind"], "COMMENT");
    assert_eq!(hits[0]["id"], cid);
    assert_eq!(hits[0]["taskId"], task, "comment result carries its parent task");
    assert!(!hits[0]["snippet"].as_str().unwrap().contains('<'), "snippet is text, not markup");

    assert!(find(&router, &token(&outsider), &t).await.is_empty(), "non-member sees nothing");

    ok(&router, &format!("{COMMENT}/DeleteComment"), &to, json!({ "id": cid })).await;
    assert!(find(&router, &to, &t).await.is_empty(), "deleted comment gone");
}
```

- [ ] **Step 2: Run to confirm it fails for the right reason**

Run: `cargo test -p transport --test search_flow`
Expected: the `search_router` compile error. Correct.

- [ ] **Step 3: Add the index calls**

Add to the imports in `comment_service.rs`:

```rust
use crate::search::{comment_doc, deindex, index, kind};
```

In `create_comment`, after `let c = require_comment(&store, pid).await?;`:

```rust
    index(&store, comment_doc(&pid.to_string(), &project_id, &c.content)).await;
```

In `update_comment`, after its reload of the updated record (same position, before the `Ok(...)`):

```rust
    index(&store, comment_doc(&pid.to_string(), &project_id, &c.content)).await;
```

In `delete_comment`, after `store.delete(pid).await.map_err(internal)?;`:

```rust
    deindex(&store, kind::COMMENT, &pid.to_string()).await;
```

If `update_comment` or `delete_comment` does not already have `project_id` in scope, it resolves the project the same way `create_comment` does — reuse that existing call rather than adding a new lookup.

- [ ] **Step 4: Verify it compiles**

Run: `cargo check -p transport`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/crates/transport/src/comments/comment_service.rs apps/backend-rs/crates/transport/tests/search_flow.rs
git commit -m "feat(search): index comments"
```

---

### Task 7: Index projects

**Files:**
- Modify: `apps/backend-rs/crates/transport/src/projects/project_service.rs`

- [ ] **Step 1: Add the failing test**

Append to `crates/transport/tests/search_flow.rs`:

```rust
#[tokio::test]
async fn project_is_indexed_and_delete_clears_its_children() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let to = token(&owner);

    let pname = term();
    let pid = ok(&router, &format!("{PROJECT}/CreateProject"), &to, json!({ "name": format!("Proyek {pname}") }))
        .await["id"].as_str().unwrap().to_string();

    let hits = find(&router, &to, &pname).await;
    assert_eq!(hits.len(), 1, "project findable: {hits:?}");
    assert_eq!(hits[0]["kind"], "PROJECT");
    assert_eq!(hits[0]["id"], pid);

    // Give it a task, then delete the project: both documents must go.
    let m = module_in(&router, &to, &pid).await;
    let tterm = term();
    ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m, "title": format!("X {tterm}") })).await;
    assert_eq!(find(&router, &to, &tterm).await.len(), 1);

    ok(&router, &format!("{PROJECT}/DeleteProject"), &to, json!({ "id": pid })).await;
    assert!(find(&router, &to, &pname).await.is_empty(), "project doc gone");
    assert!(find(&router, &to, &tterm).await.is_empty(), "child task doc gone");
}
```

- [ ] **Step 2: Run to confirm it fails for the right reason**

Run: `cargo test -p transport --test search_flow`
Expected: the `search_router` compile error. Correct.

- [ ] **Step 3: Add the index calls**

Add to the imports in `project_service.rs`:

```rust
use crate::search::{deindex_project, index, project_doc};
```

Unlike the other services, `create_project` and `delete_project` do **not** call `activity::record` — there is no existing line to anchor to, so the exact positions matter.

There is also no `UpdateProject` RPC: a project's name and description are only ever set at creation (`SetProjectStatus` and `TransferProjectOwnership` change neither, and neither field is indexed from them). So a project is indexed once and deindexed once, with nothing in between.

In `create_project`, replace the final two lines:

```rust
    let p = require_project(&store, pid).await?;
    Ok(ConnectResponse::new(to_proto(&p)))
```

with:

```rust
    let p = require_project(&store, pid).await?;
    index(
        &store,
        project_doc(
            &pid.to_string(),
            &p.name,
            p.description.as_deref().unwrap_or_default(),
        ),
    )
    .await;
    Ok(ConnectResponse::new(to_proto(&p)))
```

`ProjectRecord.description` is `Option<String>`, hence the `as_deref`.

In `delete_project`, after the membership cleanup loop and before the `Ok(...)`:

```rust
    deindex_project(&store, &pid.to_string()).await;
```

`deindex_project` matches on `project_id`, and `project_doc` stores a project's own id as its `project_id` — so this one call removes the project row *and* every task, page, and comment row beneath it.

That cascade is deliberate even though `delete_project` does **not** delete the underlying modules, tasks, pages, or comments — it deletes the project and its memberships only, leaving the children orphaned in the component tables. Orphaned children are unreachable through every existing RPC (their guards resolve a project that no longer exists), so leaving them in the search index would make search the one place they could still surface. Removing them is what keeps search consistent with the rest of the app.

- [ ] **Step 4: Verify it compiles**

Run: `cargo check -p transport`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/crates/transport/src/projects/project_service.rs apps/backend-rs/crates/transport/tests/search_flow.rs
git commit -m "feat(search): index projects and cascade deindex on delete"
```

---

### Task 8: Index people

People must leave the index when suspended or deleted, matching `search_users`, which only ever returns Active users.

**Files:**
- Modify: `apps/backend-rs/crates/transport/src/users/directory_service.rs`
- Modify: `apps/backend-rs/crates/transport/src/users/auth_service.rs`

- [ ] **Step 1: Add the failing test**

Append to `crates/transport/tests/search_flow.rs`:

```rust
// Note the package: users.proto declares `package sedjiwa.tasks.auth.v1`, and
// the directory service is `UserDirectoryService`, not `UserService`.
const USERS: &str = "/sedjiwa.tasks.auth.v1.UserDirectoryService";

#[tokio::test]
async fn person_is_indexed_and_leaves_on_suspend() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    // Admin token: `SetAdmin`-free path — sign a token carrying the wildcard.
    let admin = mk_user(&store).await;
    let admin_tok = auth::sign_jwt(SECRET, &admin, &["*".to_string()], 9_999_999_999).unwrap();

    let name = term();
    let created = ok(&router, &format!("{USERS}/CreateUser"), &admin_tok, json!({
        "phone": format!("s{}", uniq()), "password": "secret123", "displayName": format!("Rina {name}")
    })).await;
    let uid = created["id"].as_str().unwrap().to_string();

    let hits = find(&router, &admin_tok, &name).await;
    assert_eq!(hits.len(), 1, "person findable: {hits:?}");
    assert_eq!(hits[0]["kind"], "USER");
    assert_eq!(hits[0]["id"], uid);

    ok(&router, &format!("{USERS}/SuspendUser"), &admin_tok, json!({ "id": uid })).await;
    assert!(find(&router, &admin_tok, &name).await.is_empty(), "suspended person leaves the index");
}
```

Add `.merge(transport::user_router(store.clone()))` to the router in `setup()`.

- [ ] **Step 2: Run to confirm it fails for the right reason**

Run: `cargo test -p transport --test search_flow`
Expected: the `search_router` compile error. Correct.

- [ ] **Step 3: Add the index calls**

Add to the imports in `directory_service.rs`:

```rust
use crate::search::{deindex, index, kind, user_doc};
```

Four handlers in `directory_service.rs` already end with a loaded `UserRecord` named `u` (`create_user`, `update_user`, `activate_user`, `suspend_user`). Insert this line immediately before each one's `Ok(ConnectResponse::new(to_proto(&u)))` — in `create_user`, `update_user`, and `activate_user`:

```rust
    index(&store, user_doc(&u.pid.to_string(), &u.display_name, &u.phone)).await;
```

`create_user` writes `UserStatus::Active` directly, so a user created by an admin is findable immediately. `activate_user` is what brings a self-registered Pending user into the index.

In `suspend_user`, use the opposite line in the same position:

```rust
    deindex(&store, kind::USER, &pid.to_string()).await;
```

In `delete_user`, after `store.delete(pid).await.map_err(internal)?;`:

```rust
    deindex(&store, kind::USER, &pid.to_string()).await;
```

In `auth_service.rs`:

- `register` — **do not index.** Registration creates a Pending user, and `search_users` only ever returns Active users. Pending users enter the index through `activate_user`.
- `update_my_profile` — it ends with the same loaded `u`, so add the same `index(...)` line before its `Ok(ConnectResponse::new(to_proto(&u)))`. It needs its own `use crate::search::{index, user_doc};` import.

- [ ] **Step 4: Verify it compiles**

Run: `cargo check -p transport`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/crates/transport/src/users apps/backend-rs/crates/transport/tests/search_flow.rs
git commit -m "feat(search): index people, and drop them on suspend or delete"
```

---

## Phase 3 — Read path

### Task 9: `SearchService`

**Files:**
- Create: `apps/backend-rs/proto/search.proto`
- Create: `apps/backend-rs/crates/transport/src/search/search_service.rs`
- Modify: `apps/backend-rs/crates/transport/build.rs`, `crates/transport/src/search/mod.rs`, `crates/transport/src/lib.rs`, `crates/app/src/router.rs`

- [ ] **Step 1: Write the proto**

`apps/backend-rs/proto/search.proto`:

```proto
syntax = "proto3";
package sedjiwa.tasks.search.v1;

// Global full-text search over the caller's visible workspace. One RPC, backed
// by a denormalized index table; ranking, permissions, and snippets are all
// resolved in SQL. See docs/…/2026-08-12-search-and-task-permalink-design.md.

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
  repeated SearchKind kinds = 2;    // empty = all kinds
  repeated string assignee_ids = 3; // person-chip refinement (tasks only)
  uint32 limit = 4;                 // 0 → 20, capped at 50
}

message SearchResult {
  SearchKind kind = 1;
  string id = 2;
  string title = 3;
  string snippet = 4;               // ts_headline output; may contain <b> marks
  optional string project_id = 5;
  optional string project_name = 6;
  optional string task_id = 7;      // comment results: the parent task
  float score = 8;
}

message SearchResponse { repeated SearchResult results = 1; }
```

- [ ] **Step 2: Register the proto with the build**

In `crates/transport/build.rs`, add `"../../proto/search.proto",` to the compile list and
`println!("cargo:rerun-if-changed=../../proto/search.proto");` to the rerun list.

- [ ] **Step 3: Write the handler**

`crates/transport/src/search/search_service.rs`:

```rust
//! SearchService: one RPC. The store does matching, permission filtering,
//! ranking, snippets, and limiting in a single statement; this handler only
//! resolves the caller's scope going in and enriches display fields coming out.

use std::collections::HashMap;
use std::sync::Arc;

use auth::AuthUser;
use axum::Extension;
use connectrpc_axum::{ConnectError, ConnectRequest, ConnectResponse};
use persistence::Store;

use super::indexer::kind;
use crate::comments::record::load_comment;
use crate::projects::record::{load_all_projects, member_project_ids};
use crate::sedjiwa::tasks::search::v1 as pb;
use crate::sedjiwa::tasks::search::v1::search_service_connect::SearchServiceBuilder;

const DEFAULT_LIMIT: u32 = 20;
const MAX_LIMIT: u32 = 50;

fn internal(e: impl std::fmt::Display) -> ConnectError {
    ConnectError::new_internal(e.to_string())
}

fn kind_to_str(k: i32) -> Option<&'static str> {
    match pb::SearchKind::try_from(k).ok()? {
        pb::SearchKind::Task => Some(kind::TASK),
        pb::SearchKind::Page => Some(kind::PAGE),
        pb::SearchKind::Comment => Some(kind::COMMENT),
        pb::SearchKind::Project => Some(kind::PROJECT),
        pb::SearchKind::User => Some(kind::USER),
        pb::SearchKind::Unspecified => None,
    }
}

fn str_to_kind(s: &str) -> pb::SearchKind {
    match s {
        kind::TASK => pb::SearchKind::Task,
        kind::PAGE => pb::SearchKind::Page,
        kind::COMMENT => pb::SearchKind::Comment,
        kind::PROJECT => pb::SearchKind::Project,
        kind::USER => pb::SearchKind::User,
        _ => pb::SearchKind::Unspecified,
    }
}

async fn search(
    Extension(store): Extension<Arc<Store>>,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::SearchRequest>,
) -> Result<ConnectResponse<pb::SearchResponse>, ConnectError> {
    let auth = user
        .map(|Extension(u)| u)
        .ok_or_else(|| ConnectError::new_unauthenticated("authentication required"))?;
    let ConnectRequest(r) = req;

    let q = r.q.trim().to_string();
    if q.is_empty() {
        return Ok(ConnectResponse::new(pb::SearchResponse { results: vec![] }));
    }

    let is_admin = auth.is_admin();
    let project_ids = if is_admin {
        vec![]
    } else {
        member_project_ids(&store, &auth.id).await.map_err(internal)?
    };
    let kinds: Vec<String> = r
        .kinds
        .iter()
        .filter_map(|k| kind_to_str(*k))
        .map(|s| s.to_string())
        .collect();
    let limit = match r.limit {
        0 => DEFAULT_LIMIT,
        n => n.min(MAX_LIMIT),
    } as i64;

    let rows = store
        .search(&q, is_admin, &project_ids, &kinds, &r.assignee_ids, limit)
        .await
        .map_err(internal)?;

    // Project names are resolved here, not stored, so a renamed project never
    // shows a stale name in a result subtitle.
    let names: HashMap<String, String> = load_all_projects(&store)
        .await
        .map_err(internal)?
        .into_iter()
        .map(|p| (p.pid.to_string(), p.name))
        .collect();

    let mut results = Vec::with_capacity(rows.len());
    for row in rows {
        // A comment result needs its parent task to build a destination URL.
        // Bounded by `limit`, so this is at most 50 lookups on the widest page.
        let task_id = if row.kind == kind::COMMENT {
            let pid = row.entity_id.parse::<i64>().ok();
            match pid {
                Some(p) => load_comment(&store, p)
                    .await
                    .map_err(internal)?
                    .map(|c| c.task_id),
                None => None,
            }
        } else {
            None
        };
        let project_name = row
            .project_id
            .as_ref()
            .and_then(|id| names.get(id).cloned());
        results.push(pb::SearchResult {
            kind: str_to_kind(&row.kind).into(),
            id: row.entity_id,
            title: row.title,
            snippet: row.snippet,
            project_id: row.project_id,
            project_name,
            task_id,
            score: row.score,
        });
    }

    Ok(ConnectResponse::new(pb::SearchResponse { results }))
}

/// SearchService router; injects the Store as a request extension.
pub fn search_router(store: Arc<Store>) -> axum::Router<()> {
    type A = Option<Extension<AuthUser>>;
    SearchServiceBuilder::<()>::new()
        .search::<_, (Extension<Arc<Store>>, A, ConnectRequest<pb::SearchRequest>)>(search)
        .build()
        .layer(Extension(store))
}
```

`load_comment` is already `pub(crate) async fn`, but the module holding it is not reachable from outside `comments`. In `crates/transport/src/comments/mod.rs`, change `mod record;` to `pub(crate) mod record;`. Nothing else about that module changes.

- [ ] **Step 4: Wire it up**

- In `crates/transport/src/search/mod.rs`, uncomment `mod search_service;` and `pub use search_service::search_router;`.
- In `crates/transport/src/lib.rs`, add `pub use search::search_router;` beside the other router exports.
- In `crates/app/src/router.rs`, add `.merge(transport::search_router(store.clone()))` to the chain.

- [ ] **Step 5: Run the whole search flow suite**

Run: `cargo test -p transport --test search_flow -- --nocapture`
Expected: all five tests from Tasks 4–8 pass, with no `skip:` line.

If a test fails on a *missing* document, the cause is almost always an index call placed before the entity was written or before the record was reloaded — check ordering first.

- [ ] **Step 6: Commit**

```bash
git add apps/backend-rs/proto/search.proto apps/backend-rs/crates/transport apps/backend-rs/crates/app/src/router.rs
git commit -m "feat(search): add SearchService over the search_doc index"
```

---

### Task 10: Ranking and the person refinement

**Files:**
- Modify: `apps/backend-rs/crates/transport/tests/search_flow.rs`

- [ ] **Step 1: Write the failing test**

```rust
#[tokio::test]
async fn ranking_kinds_filter_and_person_refinement() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let mate = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[&mate]).await;
    let to = token(&owner);
    let m = module_in(&router, &to, &pid).await;

    let t = term();
    // One task matches in the title, another only in the description.
    let titled = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({
        "moduleId": m, "title": format!("Judul {t}")
    })).await["id"].as_str().unwrap().to_string();
    ok(&router, &format!("{TASK}/CreateTask"), &to, json!({
        "moduleId": m, "title": "Lain", "description": format!("<p>isi {t}</p>")
    })).await;
    // A page also matches, to prove the kinds filter.
    let page = ok(&router, &format!("{PAGE}/CreatePage"), &to, json!({ "projectId": pid })).await["id"]
        .as_str().unwrap().to_string();
    ok(&router, &format!("{PAGE}/UpdatePage"), &to, json!({ "id": page, "title": format!("Doc {t}") })).await;

    let hits = find(&router, &to, &t).await;
    assert_eq!(hits.len(), 3, "three documents match: {hits:?}");
    assert_eq!(hits[0]["id"], titled, "a title hit ranks first");

    // Kinds filter.
    let v = ok(&router, &format!("{SEARCH}/Search"), &to, json!({ "q": t, "kinds": ["PAGE"] })).await;
    let only = v["results"].as_array().unwrap();
    assert_eq!(only.len(), 1);
    assert_eq!(only[0]["kind"], "PAGE");

    // Person refinement: assign one task to `mate`, then filter by them.
    ok(&router, &format!("{TASK}/UpdateTask"), &to, json!({
        "id": titled, "assigneeIds": { "values": [mate] }
    })).await;
    let v = ok(&router, &format!("{SEARCH}/Search"), &to, json!({ "q": t, "assigneeIds": [mate] })).await;
    let mine = v["results"].as_array().unwrap();
    assert_eq!(mine.len(), 1, "only that person's task: {mine:?}");
    assert_eq!(mine[0]["id"], titled);
    assert_eq!(mine[0]["kind"], "TASK", "non-task kinds have empty assignees, so they drop out");
}
```

- [ ] **Step 2: Run the test**

Run: `cargo test -p transport --test search_flow ranking -- --nocapture`
Expected: PASS. Tasks 1–9 already implement everything this exercises; this test exists to prove the ranking weights and the empty-array overlap behaviour, both of which are easy to break later and impossible to notice by eye.

If the person refinement fails, check that `update_task` re-indexes with the *new* assignee list rather than the stale one loaded before the write.

- [ ] **Step 3: Commit**

```bash
git add apps/backend-rs/crates/transport/tests/search_flow.rs
git commit -m "test(search): pin ranking weights, kind filter, and person refinement"
```

---

### Task 11: `bin/reindex`

**Files:**
- Create: `apps/backend-rs/crates/app/src/bin/reindex.rs`

- [ ] **Step 1: Write the binary**

The document builders live in `transport` as `pub(crate)`, so this binary rebuilds documents from the domain records directly. Keep the field mapping identical to `indexer.rs` — if the two drift, search results drift with them.

```rust
//! Rebuild the entire search index from the component tables.
//!
//! The write-path indexer is best-effort: a failed index write is logged, not
//! retried. This binary is the remedy. Run it after deploying search for the
//! first time (existing rows have never been indexed) and any time the index is
//! suspect.
//!
//! Env: `DATABASE_URL` (required).

use anyhow::{anyhow, Result};
use domain::comment::CommentInfo;
use domain::module::{ModuleName, ModuleProjectRef};
use domain::page::PageInfo;
use domain::project::{ProjectDescription, ProjectName};
use domain::task::{TaskAssignees, TaskInfo, TaskModuleRef};
use domain::user::{UserPhone, UserProfile, UserStatusComponent};
use persistence::{SearchDoc, Store};
use std::collections::HashMap;

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    let url = std::env::var("DATABASE_URL").map_err(|_| anyhow!("DATABASE_URL not set"))?;
    let store = Store::connect(&url, domain::register_all).await?;

    store.clear_index().await?;
    let mut n = 0usize;

    // module pid → project id, so tasks and comments can resolve their project.
    let modules: HashMap<String, String> = store
        .query::<ModuleName, (String, String)>(None, |w, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| {
                    let r = w.get::<ModuleProjectRef>(*e)?;
                    Some((pid.to_string(), r.project_id.clone()))
                })
                .collect()
        })
        .await?
        .into_iter()
        .collect();

    // Projects.
    let projects = store
        .query::<ProjectName, (String, String, String)>(None, |w, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| {
                    let name = w.get::<ProjectName>(*e)?.value.clone();
                    let desc = w
                        .get::<ProjectDescription>(*e)
                        .map(|d| d.value.clone())
                        .unwrap_or_default();
                    Some((pid.to_string(), name, desc))
                })
                .collect()
        })
        .await?;
    for (id, name, desc) in projects {
        store
            .index_doc(SearchDoc {
                kind: "project".into(),
                entity_id: id.clone(),
                project_id: Some(id),
                title: name,
                body: domain::sanitize::plain_text(&desc),
                assignee_ids: vec![],
            })
            .await?;
        n += 1;
    }

    // Tasks. task pid → project id, kept for the comment pass below.
    let tasks = store
        .query::<TaskInfo, (String, String, String, String, Vec<String>)>(None, |w, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| {
                    let info = w.get::<TaskInfo>(*e)?;
                    let mref = w.get::<TaskModuleRef>(*e)?;
                    let assignees = w
                        .get::<TaskAssignees>(*e)
                        .map(|a| a.user_ids.clone())
                        .unwrap_or_default();
                    Some((
                        pid.to_string(),
                        mref.module_id.clone(),
                        info.title.clone(),
                        info.description.clone(),
                        assignees,
                    ))
                })
                .collect()
        })
        .await?;
    let mut task_project: HashMap<String, String> = HashMap::new();
    for (id, module_id, title, description, assignees) in tasks {
        let Some(project_id) = modules.get(&module_id).cloned() else {
            continue; // orphaned task: no module, so nothing can see it anyway
        };
        task_project.insert(id.clone(), project_id.clone());
        store
            .index_doc(SearchDoc {
                kind: "task".into(),
                entity_id: id,
                project_id: Some(project_id),
                title,
                body: domain::sanitize::plain_text(&description),
                assignee_ids: assignees,
            })
            .await?;
        n += 1;
    }

    // Pages.
    let pages = store
        .query::<PageInfo, (String, String, String, String)>(None, |w, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| {
                    let p = w.get::<PageInfo>(*e)?;
                    Some((
                        pid.to_string(),
                        p.project_id.clone(),
                        p.title.clone(),
                        p.content.clone(),
                    ))
                })
                .collect()
        })
        .await?;
    for (id, project_id, title, content) in pages {
        store
            .index_doc(SearchDoc {
                kind: "page".into(),
                entity_id: id,
                project_id: Some(project_id),
                title,
                body: domain::sanitize::plain_text(&content),
                assignee_ids: vec![],
            })
            .await?;
        n += 1;
    }

    // Comments.
    let comments = store
        .query::<CommentInfo, (String, String, String)>(None, |w, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| {
                    let c = w.get::<CommentInfo>(*e)?;
                    Some((pid.to_string(), c.task_id.clone(), c.content.clone()))
                })
                .collect()
        })
        .await?;
    for (id, task_id, content) in comments {
        let Some(project_id) = task_project.get(&task_id).cloned() else {
            continue;
        };
        store
            .index_doc(SearchDoc {
                kind: "comment".into(),
                entity_id: id,
                project_id: Some(project_id),
                title: String::new(),
                body: domain::sanitize::plain_text(&content),
                assignee_ids: vec![],
            })
            .await?;
        n += 1;
    }

    // People — Active only, matching `search_users`.
    let users = store
        .query::<UserProfile, (String, String, String, String)>(None, |w, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| {
                    let p = w.get::<UserProfile>(*e)?;
                    let s = w.get::<UserStatusComponent>(*e)?;
                    let phone = w.get::<UserPhone>(*e).map(|x| x.value.clone()).unwrap_or_default();
                    Some((pid.to_string(), p.display_name.clone(), phone, s.status.clone()))
                })
                .collect()
        })
        .await?;
    for (id, display_name, phone, status) in users {
        if status != "active" {
            continue;
        }
        store
            .index_doc(SearchDoc {
                kind: "user".into(),
                entity_id: id,
                project_id: None,
                title: display_name,
                body: phone,
                assignee_ids: vec![],
            })
            .await?;
        n += 1;
    }

    println!("reindexed {n} documents");
    Ok(())
}
```

Every field name above was checked against `crates/domain/src/` as of this plan: `ProjectName.value`, `ProjectDescription.value`, `ModuleProjectRef.project_id`, `TaskInfo.{title,description}`, `TaskModuleRef.module_id`, `TaskAssignees.user_ids`, `PageInfo.{project_id,title,content}`, `CommentInfo.{task_id,content}`, `UserProfile.display_name`, `UserPhone.value`, `UserStatusComponent.status`. If any of these has since moved, use the real field — do not add new domain fields to make this compile.

- [ ] **Step 2: Build it**

Run: `cargo build -p app --bin reindex`
Expected: success.

- [ ] **Step 3: Add the round-trip test**

Append to `crates/transport/tests/search_flow.rs`:

```rust
#[tokio::test]
async fn reindex_rebuilds_what_the_write_path_wrote() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[]).await;
    let to = token(&owner);
    let m = module_in(&router, &to, &pid).await;
    let t = term();
    ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m, "title": format!("R {t}") })).await;
    assert_eq!(find(&router, &to, &t).await.len(), 1);

    // Simulate total index loss, then prove search is empty and recoverable.
    store.clear_index().await.unwrap();
    assert!(find(&router, &to, &t).await.is_empty(), "index cleared");

    let out = std::process::Command::new(env!("CARGO_BIN_EXE_reindex"))
        .env("DATABASE_URL", std::env::var("DATABASE_URL").unwrap())
        .output()
        .expect("run reindex");
    assert!(out.status.success(), "reindex failed: {}", String::from_utf8_lossy(&out.stderr));

    assert_eq!(find(&router, &to, &t).await.len(), 1, "reindex restored the document");
}
```

`CARGO_BIN_EXE_reindex` only resolves when the binary belongs to the same package as the test. It does not — the test is in `transport`, the binary in `app`. Move this test to `crates/app/tests/reindex_flow.rs` instead, importing `transport` (already a dependency of `app`) and reusing the same harness helpers by copying them into that file.

- [ ] **Step 4: Run it**

Run: `cargo test -p app --test reindex_flow -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/crates/app
git commit -m "feat(search): add bin/reindex and prove the index is recoverable"
```

---

### Task 12: `GetTask`

A cold deep link cannot rely on a list having been loaded.

**Files:**
- Modify: `apps/backend-rs/proto/work.proto`, `crates/transport/src/work/task_service.rs`, `crates/transport/tests/work_flow.rs`

- [ ] **Step 1: Write the failing test**

Append to `crates/transport/tests/work_flow.rs`, adapting the local helper names already in that file:

```rust
#[tokio::test]
async fn get_task_is_member_gated() {
    let Some((router, store)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };
    let owner = mk_user(&store).await;
    let outsider = mk_user(&store).await;
    let pid = project_with(&router, &owner, &[]).await;
    let to = token(&owner);
    let m = ok(&router, &format!("{MODULE}/CreateModule"), &to, json!({ "projectId": pid, "name": "M" }))
        .await["id"].as_str().unwrap().to_string();
    let task = ok(&router, &format!("{TASK}/CreateTask"), &to, json!({ "moduleId": m, "title": "Deep" }))
        .await["id"].as_str().unwrap().to_string();

    let got = ok(&router, &format!("{TASK}/GetTask"), &to, json!({ "id": task })).await;
    assert_eq!(got["id"], task);
    assert_eq!(got["title"], "Deep");
    assert_eq!(got["moduleId"], m, "the dialog needs the module to render");

    let (st, _) = call(&router, &format!("{TASK}/GetTask"), Some(&token(&outsider)), json!({ "id": task })).await;
    assert_ne!(st, StatusCode::OK, "non-member denied");

    let (st, _) = call(&router, &format!("{TASK}/GetTask"), Some(&to), json!({ "id": "999999999" })).await;
    assert_ne!(st, StatusCode::OK, "unknown id is not found");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p transport --test work_flow get_task`
Expected: FAIL — the response is a 404 from the router because `GetTask` is not a registered method.

- [ ] **Step 3: Add the proto method**

In `proto/work.proto`, inside `service TaskService`, above `ListTasks`:

```proto
  rpc GetTask(GetTaskRequest) returns (Task);
```

And beside the other request messages:

```proto
message GetTaskRequest { string id = 1; }
```

- [ ] **Step 4: Implement the handler**

In `crates/transport/src/work/task_service.rs`, beside `list_tasks`:

```rust
/// Single task by id — the read a deep-linked dialog needs when no list has
/// been loaded. Member-gated through the task's module → project.
async fn get_task(
    Extension(store): StoreExt,
    user: Option<Extension<AuthUser>>,
    req: ConnectRequest<pb::GetTaskRequest>,
) -> Result<ConnectResponse<pb::Task>, ConnectError> {
    let auth = require_auth(user)?;
    let ConnectRequest(r) = req;
    let pid = parse_pid(&r.id)?;
    let t = require_task(&store, pid).await?;
    let (_, project_id) = module_project(&store, &t.module_id).await?;
    require_member(&store, &project_id, &auth).await?;
    Ok(ConnectResponse::new(to_proto(&t)))
}
```

Register it in `task_router`, above `.list_tasks`:

```rust
        .get_task::<_, (StoreExt, A, ConnectRequest<pb::GetTaskRequest>)>(get_task)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo test -p transport --test work_flow -- --nocapture`
Expected: all `work_flow` tests pass, including `get_task_is_member_gated`.

- [ ] **Step 6: Commit**

```bash
git add apps/backend-rs/proto/work.proto apps/backend-rs/crates/transport
git commit -m "feat(work): add GetTask for deep-linked task dialogs"
```

---

### Task 13: Full backend gate

- [ ] **Step 1: Run everything**

```bash
cd apps/backend-rs
rustfmt --edition 2021 --check \
  crates/persistence/src/search.rs \
  crates/transport/src/search/mod.rs \
  crates/transport/src/search/indexer.rs \
  crates/transport/src/search/search_service.rs
cargo clippy --all-targets -- -D warnings
cargo test --workspace -- --nocapture 2>&1 | grep -c "^skip:" ; cargo test --workspace
```

Expected: rustfmt silent, clippy clean, the skip count `0`, and every test passing.

**The fmt gate covers new library files only. This is deliberate, and took two corrections to get right.**

- `cargo fmt --all -- --check` can never pass: `main` carries 193 pre-existing diffs across `seed_admin.rs`, `seed_user.rs`, `auth/hash.rs` and others. Running `cargo fmt --all` to "fix" it would bury this feature under hundreds of unrelated hunks.
- Gating on *every changed* file fails too, for the same reason one level down: `task_service.rs` alone already had 5 diffs at `origin/main`. Formatting a file this work merely edits sweeps in drift that predates it.
- New **test** files are excluded on purpose. The flow tests are written in a deliberately dense style — one-line `ok(router, &format!(…), …)` calls that rustfmt would explode across many lines. `comment_flow.rs`, the file `search_flow.rs` was modelled on, carries 11 diffs of its own. Formatting the new test would make it the only odd-looking file in the directory.

So: new library files must be clean, everything else is left as found. Clippy, by contrast, *is* genuinely clean workspace-wide at baseline, so `-D warnings` across all targets is a real gate — keep it and keep it passing.

- [ ] **Step 2: Commit any formatting fixes**

```bash
git add -A apps/backend-rs
git commit -m "chore(backend-rs): fmt and clippy after search"
```

---

## Phase 4 — Frontend

### Task 14: Regenerate clients and scaffold the feature

**Files:**
- Create: `apps/frontend/src/features/search/{types.ts,index.ts}`, `api/{mappers.ts,hooks.ts}`, `atoms/overlay.ts`
- Generated: `apps/frontend/src/lib/gen/search_pb.ts`, `work_pb.ts`

- [ ] **Step 1: Regenerate**

```bash
cd apps/frontend
./node_modules/.bin/buf generate
```

Expected: `src/lib/gen/search_pb.ts` appears and `work_pb.ts` gains `getTask`.

- [ ] **Step 2: Write `types.ts`**

```typescript
export type SearchKind = "task" | "page" | "comment" | "project" | "user";

/** Flat result row. `snippet` carries <b> marks from Postgres ts_headline. */
export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  snippet: string;
  projectId?: string;
  projectName?: string;
  /** Comment hits only: the task the comment belongs to. */
  taskId?: string;
  score: number;
}
```

- [ ] **Step 3: Write `api/mappers.ts`**

```typescript
import { SearchKind as PbKind, type SearchResult } from "@/lib/gen/search_pb";
import type { SearchHit, SearchKind } from "../types";

const KINDS: Record<number, SearchKind> = {
  [PbKind.TASK]: "task",
  [PbKind.PAGE]: "page",
  [PbKind.COMMENT]: "comment",
  [PbKind.PROJECT]: "project",
  [PbKind.USER]: "user",
};

export function mapHit(r: SearchResult): SearchHit {
  return {
    kind: KINDS[r.kind] ?? "task",
    id: r.id,
    title: r.title,
    snippet: r.snippet,
    projectId: r.projectId,
    projectName: r.projectName,
    taskId: r.taskId,
    score: r.score,
  };
}
```

- [ ] **Step 4: Write `api/hooks.ts`**

```typescript
// Global search (connect-query over SearchService). Read-only, so there is
// nothing to invalidate — the index is rebuilt by the backend write path.

import { useEffect, useState } from "react";
import { useQuery } from "@connectrpc/connect-query";
import { SearchService } from "@/lib/gen/search_pb";
import type { SearchHit } from "../types";
import { mapHit } from "./mappers";

/** Minimum query length. One character matches half the workspace. */
export const MIN_QUERY = 2;

export function useDebounced<T>(value: T, ms = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function useSearch(q: string, assigneeIds: string[] = []) {
  const debouncedQ = useDebounced(q);
  const enabled = debouncedQ.trim().length >= MIN_QUERY;
  const result = useQuery(
    SearchService.method.search,
    { q: debouncedQ.trim(), assigneeIds },
    { enabled, retry: false },
  );
  const hits: SearchHit[] = (result.data?.results ?? []).map(mapHit);
  // `isFetching` rather than `isLoading`: a refetch under a changing query
  // should still read as "searching", not as stale results.
  return { ...result, hits, enabled, isSearching: enabled && result.isFetching };
}
```

- [ ] **Step 5: Write `atoms/overlay.ts`**

```typescript
import { atom } from "jotai";

/** Overlay visibility. Owned here so any component can open it (Cmd+K). */
export const searchOpenAtom = atom(false);

/** The person chip, if one is active. Selecting a person result sets this
 *  instead of navigating — there is no person page yet, by design. */
export const searchPersonAtom = atom<{ id: string; name: string } | null>(null);
```

- [ ] **Step 6: Write `index.ts`**

```typescript
export { SearchOverlay } from "./components/search-overlay";
export { searchOpenAtom, searchPersonAtom } from "./atoms/overlay";
export { useSearch, MIN_QUERY } from "./api/hooks";
export type { SearchHit, SearchKind } from "./types";
```

`SearchOverlay` does not exist until Task 15; the type-check will fail until then. That is expected — commit at the end of Task 15.

---

### Task 15: The overlay

**Files:**
- Create: `apps/frontend/src/features/search/components/{search-overlay.tsx,snippet.tsx}`
- Modify: `apps/frontend/src/features/auth/components/app-shell.tsx`

- [ ] **Step 1: Write `snippet.tsx`**

```typescript
import DOMPurify from "dompurify";

/** Renders Postgres `ts_headline` output. The only markup it can legitimately
 *  contain is <b> around matched terms; everything else is stripped rather than
 *  trusted, since the underlying text is user-authored. */
export function Snippet({ html }: { html: string }) {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["b"],
    ALLOWED_ATTR: [],
  });
  return (
    <span
      className="text-xs text-text-muted [&_b]:font-semibold [&_b]:text-text"
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
```

- [ ] **Step 2: Write `search-overlay.tsx`**

```typescript
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { FileText, FolderKanban, ListTodo, MessageSquare, User, X } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { SearchHit, SearchKind } from "../types";
import { MIN_QUERY, useSearch } from "../api/hooks";
import { searchOpenAtom, searchPersonAtom } from "../atoms/overlay";
import { Snippet } from "./snippet";

/** Fixed group order. Ordering *within* a group follows the server's score;
 *  the groups themselves never reorder, so the list does not reshuffle under
 *  the cursor while typing. */
const GROUPS: { kind: SearchKind; label: string; icon: typeof ListTodo }[] = [
  { kind: "task", label: "Tasks", icon: ListTodo },
  { kind: "page", label: "Pages", icon: FileText },
  { kind: "comment", label: "Comments", icon: MessageSquare },
  { kind: "project", label: "Projects", icon: FolderKanban },
  { kind: "user", label: "People", icon: User },
];

export function SearchOverlay() {
  const [open, setOpen] = useAtom(searchOpenAtom);
  const [person, setPerson] = useAtom(searchPersonAtom);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const { hits, isSearching, isError } = useSearch(q, person ? [person.id] : []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  // Reset the query on close so the next Cmd+K starts clean; the person chip
  // survives, because refining and re-opening is a normal loop.
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  function go(hit: SearchHit) {
    if (hit.kind === "user") {
      setPerson({ id: hit.id, name: hit.title });
      return; // no person page exists yet — refine instead of navigating
    }
    setOpen(false);
    const projectId = hit.projectId;
    if (!projectId) return;
    if (hit.kind === "task") {
      navigate({
        to: "/projects/$projectId/all-tasks",
        params: { projectId },
        search: { task: hit.id },
      });
    } else if (hit.kind === "comment" && hit.taskId) {
      navigate({
        to: "/projects/$projectId/all-tasks",
        params: { projectId },
        search: { task: hit.taskId, comment: hit.id },
      });
    } else if (hit.kind === "page") {
      navigate({
        to: "/projects/$projectId/pages",
        params: { projectId },
        search: { page: hit.id },
      });
    } else if (hit.kind === "project") {
      navigate({ to: "/projects/$projectId", params: { projectId } });
    }
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      {person && (
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          <span className="flex items-center gap-1 rounded-full bg-brand-subtle px-2 py-0.5 text-xs text-brand-text">
            {person.name}
            <button
              type="button"
              aria-label="Remove person filter"
              onClick={() => setPerson(null)}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      )}
      <CommandInput
        placeholder="Search tasks, pages, comments, projects, people…"
        value={q}
        onValueChange={setQ}
      />
      <CommandList>
        {/* cmdk filters its own items by default; ours are server-filtered, so
            the list must render whatever the server returned. `shouldFilter` is
            disabled on the Command root inside CommandDialog — see Step 3. */}
        {isError ? (
          <div className="px-4 py-6 text-center text-sm text-danger">
            Search failed. Try again.
          </div>
        ) : q.trim().length < MIN_QUERY ? (
          <div className="px-4 py-6 text-center text-sm text-text-muted">
            Type at least {MIN_QUERY} characters.
          </div>
        ) : isSearching && hits.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-text-muted">Searching…</div>
        ) : (
          <>
            <CommandEmpty>No results.</CommandEmpty>
            {GROUPS.map(({ kind, label, icon: Icon }) => {
              const rows = hits.filter((h) => h.kind === kind);
              if (rows.length === 0) return null;
              return (
                <CommandGroup key={kind} heading={label}>
                  {rows.map((hit) => (
                    <CommandItem key={`${hit.kind}:${hit.id}`} value={`${hit.kind}:${hit.id}`} onSelect={() => go(hit)}>
                      <Icon className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">
                          {hit.title || hit.projectName || "Untitled"}
                        </span>
                        {/* People are matched on their phone number; showing it
                            in a result row would leak a detail the row does not
                            need. Name and project subtitle only. */}
                        {hit.kind !== "user" && hit.snippet && <Snippet html={hit.snippet} />}
                        {hit.projectName && hit.kind !== "project" && (
                          <span className="truncate text-xs text-text-muted">
                            {hit.projectName}
                          </span>
                        )}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
```

- [ ] **Step 3: Disable cmdk's client-side filter**

Open `src/components/ui/command.tsx` and check whether `CommandDialog` forwards props to the inner `Command`. If it does, pass `shouldFilter={false}` from the overlay. If it does not, add a `shouldFilter` prop to `CommandDialog` that forwards to `Command`, defaulting to `true` so the existing label and assignee pickers are untouched.

Without this, cmdk re-filters the server's results against the raw query string and silently drops rows that matched on a stemmed form — the exact benefit full-text search was chosen for.

- [ ] **Step 4: Mount it in the shell**

In `src/features/auth/components/app-shell.tsx`:

```typescript
import { SearchOverlay } from "@/features/search";
```

Add a trigger button in the header, left of `<ThemeToggle />`, and mount the overlay once at the end of the outer `<div>`:

```typescript
import { useSetAtom } from "jotai";
import { Search } from "lucide-react";
import { searchOpenAtom } from "@/features/search";
```

```typescript
  const openSearch = useSetAtom(searchOpenAtom);
```

```typescript
        <header className={/* unchanged */}>
          <button
            type="button"
            onClick={() => openSearch(true)}
            aria-label="Search"
            className="flex items-center gap-2 rounded-full bg-surface-raised px-3 py-1.5 text-sm text-text-muted shadow-1 transition-colors [transition-duration:var(--duration-fast)] hover:text-text"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden rounded bg-surface px-1.5 text-xs sm:inline">⌘K</kbd>
          </button>
          <div className="flex-1" />
          <ThemeToggle />
          <NotificationBell />
        </header>
```

and, as the last child of the outermost `<div className="flex min-h-screen bg-surface">`:

```typescript
      <SearchOverlay />
```

Note the header currently uses `justify-end`; adding the search button on the left means changing that to `justify-start` with the `flex-1` spacer shown above.

- [ ] **Step 5: Verify**

```bash
cd apps/frontend
bun run tsc --noEmit && bun run lint
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/features/search apps/frontend/src/features/auth/components/app-shell.tsx apps/frontend/src/components/ui/command.tsx apps/frontend/src/lib/gen
git commit -m "feat(search): add the Cmd+K search overlay"
```

---

### Task 16: URL-addressed task dialog

**Files:**
- Modify: `apps/frontend/src/routes/_authed/projects/$projectId.tsx`
- Modify: `apps/frontend/src/features/tasks/api/hooks.ts`
- Modify: `apps/frontend/src/features/tasks/components/all-tasks-tab.tsx`

- [ ] **Step 1: Declare the search params on the layout route**

`src/routes/_authed/projects/$projectId.tsx`:

```typescript
import { createFileRoute } from "@tanstack/react-router";
import { ProjectShell } from "@/features/projects";

/** `task` / `comment` live on the layout route, not on a tab, so a deep link
 *  opens the dialog over whichever tab the user lands on. */
type DetailSearch = { task?: string; comment?: string };

export const Route = createFileRoute("/_authed/projects/$projectId")({
  validateSearch: (search: Record<string, unknown>): DetailSearch => ({
    task: typeof search.task === "string" ? search.task : undefined,
    comment: typeof search.comment === "string" ? search.comment : undefined,
  }),
  component: DetailShell,
});

function DetailShell() {
  const { projectId } = Route.useParams();
  return <ProjectShell projectId={projectId} />;
}
```

- [ ] **Step 2: Add the `useTask` hook**

Append to `src/features/tasks/api/hooks.ts`:

```typescript
/** Single task by id — for a deep-linked dialog, where no list has loaded. */
export function useTask(id: string | undefined) {
  const result = useQuery(
    TaskService.method.getTask,
    { id: id ?? "" },
    { enabled: !!id, retry: false },
  );
  return { ...result, task: result.data ? mapTask(result.data) : undefined };
}
```

`useQuery`, `TaskService`, and `mapTask` are all already imported at the top of that file — add nothing to the import block.

- [ ] **Step 3: Drive the dialog from the URL**

In `src/features/tasks/components/all-tasks-tab.tsx`:

```typescript
import { useNavigate, useSearch } from "@tanstack/react-router";
```

The file currently imports `{ useMemo, useState }` from `react` — extend it to `{ useEffect, useMemo, useState }`. `toast` is already imported. Add `useTask` to the existing `../api/hooks` import, which today reads `import { useModules, useTasks, useMoveTask, useReorderModules } from "../api/hooks";`.

Replace the `taskDialog` state's *edit* path with URL state. Keep the create path in local state — creating a task has no id to put in a URL.

```typescript
  const navigate = useNavigate();
  const { task: taskParam, comment: commentParam } = useSearch({
    from: "/_authed/projects/$projectId",
  });
  const { task: deepTask, isError: deepTaskError } = useTask(taskParam);

  // The task may already be in the list; fall back to the fetched one so a cold
  // deep link works and a warm click does not wait on a round-trip.
  const urlTask = taskParam
    ? tasks.find((t) => t.id === taskParam) ?? deepTask
    : undefined;

  function openTask(id: string) {
    navigate({ to: ".", search: (s) => ({ ...s, task: id }), replace: false });
  }
  function closeTask() {
    navigate({ to: ".", search: (s) => ({ ...s, task: undefined, comment: undefined }) });
  }

  useEffect(() => {
    if (taskParam && deepTaskError) {
      toast.error("Task not found, or you do not have access");
      closeTask();
    }
  }, [taskParam, deepTaskError]);
```

Change `ModuleSection`'s `onEditTask` to `onEditTask={(task) => openTask(task.id)}`, and render two dialogs — one URL-driven for editing, one state-driven for creating:

```typescript
      {/* Edit: addressed by URL, so Back closes it and the link is shareable. */}
      <TaskDialog
        open={!!urlTask}
        onOpenChange={(open) => {
          if (!open) closeTask();
        }}
        projectId={projectId}
        moduleId={urlTask?.moduleId ?? ""}
        task={urlTask}
        memberIds={memberIds}
        userMap={userMap}
        highlightCommentId={commentParam}
      />
      {/* Create: no id yet, so nothing to address. */}
      <TaskDialog
        open={taskDialog.open}
        onOpenChange={(open) => setTaskDialog((s) => ({ ...s, open }))}
        projectId={projectId}
        moduleId={taskDialog.moduleId}
        memberIds={memberIds}
        userMap={userMap}
      />
```

Trim the `taskDialog` state type to `{ open: boolean; moduleId: string }` — the `task` field is now unreachable.

- [ ] **Step 4: Accept the highlight prop**

In `src/features/tasks/components/task-dialog.tsx`, add `highlightCommentId?: string` to `Props`, destructure it, and pass it through:

```typescript
            <CommentThread
              taskId={task.id}
              projectId={projectId}
              highlightCommentId={highlightCommentId}
            />
```

- [ ] **Step 5: Verify**

```bash
cd apps/frontend
bun run tsc --noEmit && bun run lint
```

Expected: one error remaining — `CommentThread` does not accept `highlightCommentId`. Task 17 fixes it.

---

### Task 17: Comment highlight

**Files:**
- Modify: `apps/frontend/src/features/comments/components/comment-thread.tsx`

- [ ] **Step 1: Accept and act on the prop**

```typescript
export function CommentThread({
  taskId,
  projectId,
  highlightCommentId,
}: {
  taskId: string;
  projectId: string;
  /** Deep-linked comment: scroll to it and mark it, once, after load. */
  highlightCommentId?: string;
}) {
```

Add, after the existing hooks:

```typescript
  const highlightRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (!highlightCommentId || isLoading) return;
    highlightRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightCommentId, isLoading]);
```

Each comment renders as `<li key={c.id} className="flex gap-3">` inside the `comments.map(...)`. Replace that opening tag with:

```typescript
              <li
                key={c.id}
                ref={c.id === highlightCommentId ? highlightRef : undefined}
                className={cn(
                  "flex gap-3",
                  c.id === highlightCommentId &&
                    "rounded-lg bg-brand-subtle p-2 ring-1 ring-brand",
                )}
              >
```

`highlightRef` is typed `HTMLDivElement | null` above; change it to `HTMLLIElement | null` to match the element it now attaches to.

The file already imports `useState` from `react` and `getInitials` from `@/lib/utils` — extend those two imports to `{ useEffect, useRef, useState }` and `{ cn, getInitials }` rather than adding new import lines.

- [ ] **Step 2: Verify**

```bash
cd apps/frontend
bun run tsc --noEmit && bun run lint
```

Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/routes apps/frontend/src/features/tasks apps/frontend/src/features/comments
git commit -m "feat(tasks): address the task dialog by URL, with comment deep links"
```

---

### Task 18: Page deep links

**Files:**
- Modify: `apps/frontend/src/routes/_authed/projects/$projectId/pages.tsx`
- Modify: `apps/frontend/src/features/pages/components/pages-tab.tsx`

- [ ] **Step 1: Declare the param**

`src/routes/_authed/projects/$projectId/pages.tsx`:

```typescript
import { createFileRoute } from "@tanstack/react-router";
import { PagesTab } from "@/features/pages";

export const Route = createFileRoute("/_authed/projects/$projectId/pages")({
  validateSearch: (search: Record<string, unknown>): { page?: string } => ({
    page: typeof search.page === "string" ? search.page : undefined,
  }),
  component: Pages,
});

function Pages() {
  const { projectId } = Route.useParams();
  const { page } = Route.useSearch();
  return <PagesTab projectId={projectId} selectedId={page} />;
}
```

- [ ] **Step 2: Convert the tab's selection to URL state**

`pages-tab.tsx` currently owns `selectedId` in `useState` and defaults to the first page via an effect. Replace the state with the prop, and write selection back to the URL so it is shareable:

```typescript
export function PagesTab({
  projectId,
  selectedId: selectedFromUrl,
}: {
  projectId: string;
  selectedId?: string;
}) {
  const { pages, isLoading } = usePages(projectId);
  const create = useCreatePage();
  const navigate = useNavigate();

  function select(id: string | undefined) {
    navigate({ to: ".", search: (s) => ({ ...s, page: id }) });
  }

  // Default selection → first page; also recovers when the selected page is
  // deleted or the deep-linked id does not exist in this project.
  useEffect(() => {
    if (pages.length === 0) return;
    if (!selectedFromUrl || !pages.some((p) => p.id === selectedFromUrl)) {
      select(pages[0].id);
    }
  }, [pages, selectedFromUrl]);

  const selected = pages.find((p) => p.id === selectedFromUrl) ?? null;
```

Replace every `setSelectedId(x)` call with `select(x)` — including the `onSuccess` of `newPage`. Import `useNavigate` from `@tanstack/react-router`.

- [ ] **Step 3: Verify**

```bash
cd apps/frontend
bun run tsc --noEmit && bun run lint
```

Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/routes/_authed/projects/\$projectId/pages.tsx apps/frontend/src/features/pages
git commit -m "feat(pages): address the selected page by URL"
```

---

### Task 19: Notifications land on the task

**Files:**
- Modify: `apps/frontend/src/features/notifications/components/notification-bell.tsx`

- [ ] **Step 1: Use the ids the notification already carries**

Replace the `onClick` handler and delete the comment at line 39 explaining the limitation — the limitation is gone:

```typescript
  function onClick(n: Notification) {
    if (!n.read) markRead.mutate({ ids: [n.id] });
    if (!n.projectId) return;
    if (n.taskId) {
      // `Notification` has carried taskId/commentId all along; before the task
      // dialog had a URL there was simply nowhere to send them.
      navigate({
        to: "/projects/$projectId/all-tasks",
        params: { projectId: n.projectId },
        search: { task: n.taskId, comment: n.commentId },
      });
      return;
    }
    navigate({ to: "/projects/$projectId", params: { projectId: n.projectId } });
  }
```

Check `features/notifications/types.ts` for the flat field names (`taskId` / `commentId`); if the mapper drops them, add them there and to the flat `Notification` type.

- [ ] **Step 2: Verify**

```bash
cd apps/frontend
bun run tsc --noEmit && bun run lint
```

Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/features/notifications
git commit -m "feat(notifications): deep-link mentions to the task and comment"
```

---

### Task 20: Final verification

- [ ] **Step 1: Backend**

```bash
cd apps/backend-rs
rustfmt --edition 2021 --check \
  crates/persistence/src/search.rs \
  crates/transport/src/search/mod.rs \
  crates/transport/src/search/indexer.rs \
  crates/transport/src/search/search_service.rs
cargo clippy --all-targets -- -D warnings && cargo test --workspace
```

Expected: all clean, no `skip:` lines in the output. Same scoping as Task 13, and for the reasons documented there — new library files only.

- [ ] **Step 2: Frontend**

```bash
cd apps/frontend
bun run tsc --noEmit && bun run lint && bun run build
```

Expected: all three clean. `bun run build` regenerates `src/routeTree.gen.ts` with the new search params — commit that file if it changed.

- [ ] **Step 3: Backfill the index**

```bash
cd apps/backend-rs
cargo run --bin reindex
```

Expected: `reindexed N documents` with `N` > 0. Existing rows have never been indexed, so without this the overlay finds only what has been touched since the deploy.

- [ ] **Step 4: Manual smoke test**

Start both dev servers (`cd apps/backend-rs && cargo run`, `cd apps/frontend && bun run dev`), sign in, and confirm:

1. `Cmd+K` opens the overlay from any page.
2. Typing two characters of a known task title lists it under **Tasks** with its project as the subtitle.
3. Enter opens the task dialog, and the URL carries `?task=<id>`.
4. Browser Back closes the dialog.
5. Reloading that URL in a fresh tab reopens the dialog on the same task.
6. Searching a word that only appears in a comment lists it under **Comments**; opening it scrolls to and highlights that comment.
7. Selecting a person adds a chip and narrows results to their tasks; the X removes it.
8. Editing the URL to `?task=999999999` shows the not-found toast and clears the param.

- [ ] **Step 5: Commit any remaining generated files**

```bash
git add apps/frontend/src/routeTree.gen.ts
git commit -m "chore(frontend): regenerate route tree with search params"
```
