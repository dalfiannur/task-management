//! Comment records ↔ proto + store lookups.

use arke::{Entity, World};
use domain::comment::CommentInfo;
use persistence::Store;

use crate::sedjiwa::tasks::comment::v1 as pb;

#[derive(Debug, Clone)]
pub(crate) struct CommentRecord {
    pub pid: i64,
    pub task_id: String,
    pub author_id: String,
    pub content: String,
    pub mentioned_user_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub(crate) fn read_comment(world: &World, e: Entity, pid: i64) -> Option<CommentRecord> {
    let c = world.get::<CommentInfo>(e)?;
    Some(CommentRecord {
        pid,
        task_id: c.task_id.clone(),
        author_id: c.author_id.clone(),
        content: c.content.clone(),
        mentioned_user_ids: c.mentioned_user_ids.clone(),
        created_at: c.created_at.clone(),
        updated_at: c.updated_at.clone(),
    })
}

pub(crate) fn to_proto(c: &CommentRecord) -> pb::Comment {
    pb::Comment {
        id: c.pid.to_string(),
        task_id: c.task_id.clone(),
        author_id: c.author_id.clone(),
        content: c.content.clone(),
        mentioned_user_ids: c.mentioned_user_ids.clone(),
        created_at: c.created_at.clone(),
        updated_at: c.updated_at.clone(),
    }
}

pub(crate) async fn load_comment(store: &Store, pid: i64) -> anyhow::Result<Option<CommentRecord>> {
    let pred = format!("pid = {pid}");
    let mut v = store
        .query::<CommentInfo, CommentRecord>(Some(&pred), |world, pairs| {
            pairs
                .iter()
                .filter_map(|(p, e)| read_comment(world, *e, *p))
                .collect()
        })
        .await?;
    Ok(v.pop())
}

/// Comments of a task, chronological (created_at asc, then pid).
pub(crate) async fn comments_for_task(
    store: &Store,
    task_id: &str,
) -> anyhow::Result<Vec<CommentRecord>> {
    let t = task_id.to_string();
    let mut v = store
        .query::<CommentInfo, CommentRecord>(None, move |world, pairs| {
            pairs
                .iter()
                .filter_map(|(pid, e)| read_comment(world, *e, *pid))
                .filter(|c| c.task_id == t)
                .collect()
        })
        .await?;
    v.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.pid.cmp(&b.pid)));
    Ok(v)
}
