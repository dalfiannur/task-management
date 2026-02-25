import { Badge } from "@/components/ui/badge";
import { MODULE_COLORS } from "@/components/modules/module-section";
import {
  type TimelineRow,
  ROW_HEIGHT,
  formatDateRange,
} from "./timeline-utils";
import styles from "./gantt-task-panel.module.css";

interface GanttTaskPanelProps {
  rows: TimelineRow[];
  headerHeight: number;
}

export function GanttTaskPanel({ rows, headerHeight }: GanttTaskPanelProps) {
  return (
    <div>
      <div
        className={styles.header}
        style={{ height: headerHeight }}
      >
        <span className={styles.headerLabel}>Task</span>
      </div>

      {rows.map((row) => {
        if (row.type === "module") {
          const color =
            MODULE_COLORS[row.colorIndex % MODULE_COLORS.length];
          return (
            <div
              key={`mod-${row.module.id}`}
              className={styles.moduleRow}
              style={{ height: ROW_HEIGHT }}
            >
              <div
                className={styles.moduleStripe}
                style={{ backgroundColor: color }}
              />
              <span className={styles.moduleName} style={{ color }}>
                {row.module.name}
              </span>
              <Badge variant="secondary" className={styles.taskCountBadge}>
                {row.taskCount}
              </Badge>
            </div>
          );
        }

        return (
          <div
            key={`task-${row.task.id}`}
            className={styles.taskRow}
            style={{ height: ROW_HEIGHT }}
          >
            <span className={styles.taskTitle}>{row.task.title}</span>
            <span className={styles.taskDate}>
              {formatDateRange(row.task.startDate, row.task.dueDate)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
