import { useEffect, useRef } from "react";
import { MODULE_COLORS } from "@/components/modules/module-section";
import {
  type TimelineRange,
  type TimelineRow,
  type WeekGroup,
  DAY_WIDTH,
  ROW_HEIGHT,
  computeBarPosition,
  groupDaysByWeek,
  isWeekend,
  isSameDay,
  format,
  formatDateRange,
} from "./timeline-utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import styles from "./gantt-timeline-grid.module.css";

interface GanttTimelineGridProps {
  rows: TimelineRow[];
  range: TimelineRange;
  headerHeight: number;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function GanttTimelineGrid({
  rows,
  range,
  headerHeight,
  scrollContainerRef,
}: GanttTimelineGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const today = new Date();
  const weeks = groupDaysByWeek(range.days);
  const totalWidth = range.days.length * DAY_WIDTH;

  const todayIndex = range.days.findIndex((d) => isSameDay(d, today));

  useEffect(() => {
    if (todayIndex >= 0 && scrollContainerRef.current) {
      const taskPanelWidth = 300;
      const visibleTimelineWidth =
        scrollContainerRef.current.clientWidth - taskPanelWidth;
      const scrollLeft =
        todayIndex * DAY_WIDTH + DAY_WIDTH / 2 - visibleTimelineWidth / 2;
      scrollContainerRef.current.scrollLeft = Math.max(0, scrollLeft);
    }
  }, [todayIndex, scrollContainerRef]);

  return (
    <div ref={gridRef} style={{ width: totalWidth }}>
      {/* Week + Day headers */}
      <div style={{ height: headerHeight }} className={styles.headerRow}>
        {/* Week row */}
        <div className={styles.weekRow} style={{ height: headerHeight / 2 }}>
          {weeks.map((week: WeekGroup) => (
            <div
              key={week.weekStart.toISOString()}
              className={styles.weekCell}
              style={{ width: week.days.length * DAY_WIDTH }}
            >
              {format(week.weekStart, "MMM d")}
            </div>
          ))}
        </div>
        {/* Day row */}
        <div className={styles.dayRow} style={{ height: headerHeight / 2 }}>
          {range.days.map((day) => {
            const isToday = isSameDay(day, today);
            const weekend = isWeekend(day);
            return (
              <div
                key={day.toISOString()}
                className={
                  isToday
                    ? styles.dayCellToday
                    : weekend
                      ? styles.dayCellWeekend
                      : styles.dayCellNormal
                }
                style={{ width: DAY_WIDTH }}
              >
                {format(day, "d")}
              </div>
            );
          })}
        </div>
      </div>

      {/* Grid body */}
      <TooltipProvider delayDuration={200}>
        <div className={styles.bodyContainer}>
          {/* Day column backgrounds */}
          <div className={styles.columnBackgrounds}>
            {range.days.map((day) => {
              const isToday = isSameDay(day, today);
              const weekend = isWeekend(day);
              return (
                <div
                  key={day.toISOString()}
                  className={
                    isToday
                      ? styles.colBgToday
                      : weekend
                        ? styles.colBgWeekend
                        : styles.colBgNormal
                  }
                  style={{
                    width: DAY_WIDTH,
                    height: rows.length * ROW_HEIGHT,
                  }}
                />
              );
            })}
          </div>

          {/* Today marker line */}
          {todayIndex >= 0 && (
            <div
              className={styles.todayMarker}
              style={{
                left: todayIndex * DAY_WIDTH + DAY_WIDTH / 2,
                height: rows.length * ROW_HEIGHT,
              }}
            />
          )}

          {/* Rows */}
          {rows.map((row) => {
            if (row.type === "module") {
              return (
                <div
                  key={`mod-${row.module.id}`}
                  className={styles.moduleRow}
                  style={{ height: ROW_HEIGHT }}
                />
              );
            }

            const bar = computeBarPosition(row.task, range.start);
            const color =
              MODULE_COLORS[row.colorIndex % MODULE_COLORS.length];

            return (
              <div
                key={`task-${row.task.id}`}
                className={styles.taskRow}
                style={{ height: ROW_HEIGHT }}
              >
                {bar && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className={styles.taskBar}
                        style={{
                          left: bar.left,
                          width: bar.width,
                          backgroundColor: color,
                        }}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className={styles.tooltipTitle}>{row.task.title}</p>
                      <p className={styles.tooltipDate}>
                        {formatDateRange(
                          row.task.startDate,
                          row.task.dueDate,
                        )}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            );
          })}
        </div>
      </TooltipProvider>
    </div>
  );
}
