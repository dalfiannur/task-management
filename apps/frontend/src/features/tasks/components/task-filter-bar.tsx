import { format } from "date-fns";
import { X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/shared/date-picker-field";
import type { AppUser } from "@/features/auth";
import type { Label } from "@/features/labels";
import { TASK_PRIORITIES, TASK_STATUSES } from "../types";
import { TASK_PRIORITY_CONFIG, TASK_STATUS_CONFIG } from "../config";
import { hasActiveFilter, type TaskFilter } from "../filter";

/** Radix Select has no empty value, so "no filter" needs a sentinel. */
const ALL = "all";

function isoToDate(v?: string): Date | undefined {
  return v ? new Date(`${v}T00:00:00`) : undefined;
}
function dateToIso(d: Date | undefined): string | undefined {
  return d ? format(d, "yyyy-MM-dd") : undefined;
}

/**
 * Filter toolbar for the Tasks tab.
 *
 * Presentational: it owns no state. Every control writes through `onChange`
 * into the URL, which is the single source of truth for what is on screen.
 */
export function TaskFilterBar({
  filter,
  onChange,
  onClear,
  memberIds,
  userMap,
  labelMap,
  matched,
  total,
}: {
  filter: TaskFilter;
  onChange: (next: Partial<TaskFilter>) => void;
  onClear: () => void;
  memberIds: string[];
  userMap: Record<string, AppUser>;
  labelMap: Record<string, Label>;
  /** Tasks passing the filter, and the project's total — for the count line. */
  matched: number;
  total: number;
}) {
  const active = hasActiveFilter(filter);
  const labels = Object.values(labelMap).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filter.status ?? ALL}
          onValueChange={(v) =>
            onChange({ status: v === ALL ? undefined : (v as TaskFilter["status"]) })
          }
        >
          <SelectTrigger className="w-36" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {TASK_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {TASK_STATUS_CONFIG[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filter.priority ?? ALL}
          onValueChange={(v) =>
            onChange({
              priority: v === ALL ? undefined : (v as TaskFilter["priority"]),
            })
          }
        >
          <SelectTrigger className="w-36" aria-label="Filter by priority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All priorities</SelectItem>
            {TASK_PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {TASK_PRIORITY_CONFIG[p].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filter.assignee ?? ALL}
          onValueChange={(v) => onChange({ assignee: v === ALL ? undefined : v })}
        >
          <SelectTrigger className="w-44" aria-label="Filter by assignee">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All assignees</SelectItem>
            {memberIds.map((id) => (
              <SelectItem key={id} value={id}>
                {userMap[id]?.displayName ?? id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filter.label ?? ALL}
          onValueChange={(v) => onChange({ label: v === ALL ? undefined : v })}
        >
          <SelectTrigger className="w-40" aria-label="Filter by label">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All labels</SelectItem>
            {labels.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* One range over the task's lifetime: a task shows when its
            start…due span overlaps these bounds. Either end stands alone. */}
        <div className="flex items-center gap-1 rounded-md border border-border-subtle px-1">
          <DatePickerField
            value={isoToDate(filter.from)}
            onChange={(d) => onChange({ from: dateToIso(d) })}
            placeholder="From"
          />
          <span aria-hidden="true" className="text-text-subtle">
            –
          </span>
          <DatePickerField
            value={isoToDate(filter.to)}
            onChange={(d) => onChange({ to: dateToIso(d) })}
            placeholder="To"
            minDate={isoToDate(filter.from)}
          />
        </div>

        {active && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X className="mr-1 h-4 w-4" />
            Clear filters
          </Button>
        )}
      </div>

      {active && (
        <p className="text-sm text-text-muted">
          <span className="text-num">{matched}</span> of{" "}
          <span className="text-num">{total}</span> task(s) — reordering is off
          while filtered.
        </p>
      )}
    </div>
  );
}
