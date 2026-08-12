import { formatDistanceToNow, parseISO } from "date-fns";
import {
  Activity as ActivityIcon,
  CheckSquare,
  Crown,
  FileText,
  Folder,
  Paperclip,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { AppUser } from "@/features/auth";
import type { Activity, ActivityEntity } from "../types";

const ENTITY_ICON: Record<ActivityEntity, LucideIcon> = {
  task: CheckSquare,
  module: Folder,
  membership: Users,
  ownership: Crown,
  page: FileText,
  media: Paperclip,
  other: ActivityIcon,
};

function relative(iso: string): string {
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

/** Presentational audit-log list. */
export function ActivityFeed({
  activities,
  userMap,
  isLoading,
  emptyLabel = "No activity yet.",
}: {
  activities: Activity[];
  userMap: Record<string, AppUser>;
  isLoading?: boolean;
  emptyLabel?: string;
}) {
  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-xl bg-surface-raised shadow-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="border-b border-border-subtle px-4 py-3 last:border-b-0"
          >
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    );
  }
  if (activities.length === 0) {
    return (
      <p className="rounded-xl bg-surface-raised p-6 text-center text-sm text-text-muted shadow-2">
        {emptyLabel}
      </p>
    );
  }
  return (
    /* Panel yang berdiri sendiri, sama seperti UpcomingDeadlines: kartu putih
       di atas kanvas bertint. Baris kehilangan radius sendiri — sudut membulat
       di dalam sudut membulat menghasilkan kurva ganda; container yang
       memotong. */
    <ul className="overflow-hidden rounded-xl bg-surface-raised shadow-2">
      {activities.map((a) => {
        const Icon = ENTITY_ICON[a.entity];
        const actor = userMap[a.actorId]?.displayName;
        return (
          <li
            key={a.id}
            className="flex items-start gap-3 border-b border-border-subtle px-4 py-3 last:border-b-0"
          >
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-text-muted">
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                {actor && <span className="font-medium">{actor} </span>}
                {a.summary}
              </p>
              {a.changes.length > 0 && (
                <ul className="mt-0.5 space-y-0.5">
                  {a.changes.map((c, i) => (
                    <li key={i} className="text-xs text-text-muted">
                      {c.field}: {c.from || "—"} → {c.to || "—"}
                    </li>
                  ))}
                </ul>
              )}
              <span className="text-xs text-text-muted">
                {relative(a.createdAt)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
