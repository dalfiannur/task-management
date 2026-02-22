import { Badge } from "@/components/ui/badge";
import { MODULE_COLORS } from "@/components/modules/module-section";
import {
  type TimelineRow,
  ROW_HEIGHT,
  formatDateRange,
} from "./timeline-utils";

interface GanttTaskPanelProps {
  rows: TimelineRow[];
  headerHeight: number;
}

export function GanttTaskPanel({ rows, headerHeight }: GanttTaskPanelProps) {
  return (
    <div>
      <div
        className="border-b bg-muted/50 px-3 flex items-end font-medium text-sm text-muted-foreground"
        style={{ height: headerHeight }}
      >
        <span className="pb-2">Task</span>
      </div>

      {rows.map((row) => {
        if (row.type === "module") {
          const color =
            MODULE_COLORS[row.colorIndex % MODULE_COLORS.length];
          return (
            <div
              key={`mod-${row.module.id}`}
              className="flex items-center gap-2 px-3 border-b bg-muted/30"
              style={{ height: ROW_HEIGHT }}
            >
              <div
                className="w-1 rounded-full self-stretch my-2"
                style={{ backgroundColor: color }}
              />
              <span className="font-semibold text-sm" style={{ color }}>
                {row.module.name}
              </span>
              <Badge variant="secondary" className="text-xs">
                {row.taskCount}
              </Badge>
            </div>
          );
        }

        return (
          <div
            key={`task-${row.task.id}`}
            className="flex items-center gap-2 px-3 pl-7 border-b"
            style={{ height: ROW_HEIGHT }}
          >
            <span className="text-sm truncate flex-1">{row.task.title}</span>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatDateRange(row.task.startDate, row.task.dueDate)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
