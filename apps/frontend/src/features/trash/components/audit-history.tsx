import { format, formatDistanceToNowStrict } from "date-fns";
import { Eraser, History, RotateCcw, Trash2, type LucideIcon } from "lucide-react";
import { Button, Skeleton } from "sedjiwa-ui";
import { EmptyState } from "@/components/shared/empty-state";
import { useUserMap } from "@/features/users";
import { useAuditEntries, type AuditEntry } from "../api/hooks";
import { describeContents } from "./describe-contents";

const ACTIONS: Record<string, { icon: LucideIcon; verb: string; tone: string }> = {
  project_trashed: { icon: Trash2, verb: "moved to the trash", tone: "text-muted-foreground" },
  project_restored: { icon: RotateCcw, verb: "restored", tone: "text-success-subtle-text" },
  project_purged: { icon: Trash2, verb: "deleted for good", tone: "text-destructive" },
  leftovers_purged: { icon: Eraser, verb: "cleaned up leftovers", tone: "text-destructive" },
};

function headline(e: AuditEntry, actor: string): string {
  if (e.action === "leftovers_purged") {
    return `${actor} cleaned up the leftovers of ${e.projects} deleted project${e.projects === 1 ? "" : "s"}`;
  }
  const verb = ACTIONS[e.action]?.verb ?? e.action.replace(/_/g, " ");
  return `${actor} ${verb} “${e.subjectName || e.subjectId}”`;
}

/**
 * Admin: every trash, restore and purge, newest first (RFC-0004). Kept
 * forever, purges included, so "who deleted this?" always has an answer.
 */
export function AuditHistory() {
  const { entries, isLoading, isError, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useAuditEntries();
  const userMap = useUserMap();

  if (isError) {
    return <p className="text-sm text-destructive">{error?.message ?? "Failed to load the history."}</p>;
  }
  if (isLoading) return <Skeleton className="h-40 w-full rounded-xl shadow-sm" />;
  if (entries.length === 0) {
    return (
      <EmptyState
        variant="cleared"
        icon={History}
        title="Nothing has happened yet"
        body="Every project moved to the trash, restored or deleted for good is recorded here."
      />
    );
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border overflow-hidden rounded-xl bg-card shadow-sm">
        {entries.map((e) => {
          const meta = ACTIONS[e.action];
          const Icon = meta?.icon ?? History;
          const actor = userMap[e.actorId]?.displayName ?? "Someone";
          const removed =
            e.action === "project_purged" || e.action === "leftovers_purged"
              ? describeContents(e.contents)
              : null;
          const at = new Date(e.createdAt);
          return (
            <li key={e.id} className="flex items-start gap-3 px-4 py-3">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta?.tone ?? "text-muted-foreground"}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm">{headline(e, actor)}</p>
                {removed && (
                  <p className="text-num text-xs text-foreground/80">Removed: {removed}</p>
                )}
                <p className="text-xs text-muted-foreground" title={format(at, "PPpp")}>
                  {formatDistanceToNowStrict(at, { addSuffix: true })}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
            {isFetchingNextPage ? "Loading…" : "Load older"}
          </Button>
        </div>
      )}
    </div>
  );
}
