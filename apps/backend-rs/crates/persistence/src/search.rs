//! Full-text search index. A denormalized document table, deliberately outside
//! the Arke component model: it is an index, not an entity, and it is the one
//! place where user-supplied text reaches SQL — so every method here binds its
//! parameters instead of formatting them into the statement.

use anyhow::Result;
use sqlx::{PgPool, Row};

/// Postgres text-search config. `simple` is the fallback when a deployment's
/// Postgres lacks the Snowball `indonesian` dictionary; it costs stemming
/// ("mereset" no longer matches "reset") and nothing else.
///
/// Changing this value has no effect on a database where `search_doc` already
/// exists: `migrate()` uses `CREATE TABLE IF NOT EXISTS`, so the generated
/// `vec` column keeps building tsvectors with whatever config it was created
/// with — silently, with no error. Search then just stops matching the way
/// this constant claims it should. To actually apply a new value here, drop
/// the table (`DROP TABLE search_doc`) or run a real migration first.
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
        sqlx::query("TRUNCATE search_doc")
            .execute(&self.pool)
            .await?;
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
        let rows = s.search(&term, true, &[], &[], &[], 10).await.unwrap();
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

    #[tokio::test]
    async fn deindex_project_only_drops_its_own_docs() {
        let Some(s) = store().await else {
            eprintln!("skip: ARKE_TEST_DATABASE_URL not set");
            return;
        };
        let uniq = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .to_string();
        let term_a = format!("zqxa{uniq}");
        let term_b = format!("zqxb{uniq}");
        let project_a = format!("proj-a-{uniq}");
        let project_b = format!("proj-b-{uniq}");

        let mut doc_a = doc("task", &format!("ta-{uniq}"), &term_a, "body");
        doc_a.project_id = Some(project_a.clone());
        let mut doc_b = doc("task", &format!("tb-{uniq}"), &term_b, "body");
        doc_b.project_id = Some(project_b.clone());

        s.index_doc(doc_a).await.unwrap();
        s.index_doc(doc_b).await.unwrap();

        s.deindex_project(&project_a).await.unwrap();

        let rows_a = s.search(&term_a, true, &[], &[], &[], 10).await.unwrap();
        assert!(rows_a.is_empty(), "deindex_project drops its own docs");

        let rows_b = s.search(&term_b, true, &[], &[], &[], 10).await.unwrap();
        assert_eq!(
            rows_b.len(),
            1,
            "deindex_project leaves other projects alone"
        );

        s.deindex_project(&project_b).await.unwrap();
    }
}
