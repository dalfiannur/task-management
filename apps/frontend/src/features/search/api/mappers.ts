import type { SearchResult as PbSearchResult } from "@/lib/gen/search_pb";
import { SearchKind as PbSearchKind } from "@/lib/gen/search_pb";
import type { SearchHit, SearchKind } from "../types";

function mapKind(k: PbSearchKind): SearchKind {
  switch (k) {
    case PbSearchKind.TASK:
      return "task";
    case PbSearchKind.PAGE:
      return "page";
    case PbSearchKind.COMMENT:
      return "comment";
    case PbSearchKind.PROJECT:
      return "project";
    case PbSearchKind.USER:
      return "user";
    default:
      // SEARCH_KIND_UNSPECIFIED never comes back from the server in practice —
      // fall back to "task" rather than widening the union with `undefined`.
      return "task";
  }
}

export function mapSearchHit(r: PbSearchResult): SearchHit {
  return {
    kind: mapKind(r.kind),
    id: r.id,
    title: r.title,
    snippet: r.snippet,
    projectId: r.projectId,
    projectName: r.projectName,
    taskId: r.taskId,
    parentId: r.parentId,
    parentTitle: r.parentTitle,
    score: r.score,
  };
}
