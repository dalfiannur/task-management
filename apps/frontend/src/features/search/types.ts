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
  score: number;
}
