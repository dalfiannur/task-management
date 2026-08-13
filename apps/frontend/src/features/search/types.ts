// Flat FE types for the global search domain, mapped from gen/search_pb.

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
  /** Task hits that are subtasks: the parent's id, for context in the row. */
  parentId?: string;
  /** Task hits that are subtasks: the parent's title, resolved server-side
   *  (live, not stored) so a renamed parent never shows stale here. */
  parentTitle?: string;
  score: number;
}
