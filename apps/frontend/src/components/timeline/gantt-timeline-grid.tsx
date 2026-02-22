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
      <div style={{ height: headerHeight }} className="border-b">
        {/* Week row */}
        <div className="flex" style={{ height: headerHeight / 2 }}>
          {weeks.map((week: WeekGroup) => (
            <div
              key={week.weekStart.toISOString()}
              className="border-r border-b text-xs font-medium text-muted-foreground flex items-center justify-center bg-muted/50"
              style={{ width: week.days.length * DAY_WIDTH }}
            >
              {format(week.weekStart, "MMM d")}
            </div>
          ))}
        </div>
        {/* Day row */}
        <div className="flex" style={{ height: headerHeight / 2 }}>
          {range.days.map((day) => {
            const isToday = isSameDay(day, today);
            const weekend = isWeekend(day);
            return (
              <div
                key={day.toISOString()}
                className={`border-r text-[10px] flex items-center justify-center ${
                  isToday
                    ? "bg-red-100 dark:bg-red-950 font-bold text-red-600"
                    : weekend
                      ? "bg-muted/30 text-muted-foreground"
                      : "text-muted-foreground"
                }`}
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
        <div className="relative">
          {/* Day column backgrounds */}
          <div className="absolute inset-0 flex pointer-events-none">
            {range.days.map((day) => {
              const isToday = isSameDay(day, today);
              const weekend = isWeekend(day);
              return (
                <div
                  key={day.toISOString()}
                  className={`border-r shrink-0 ${
                    isToday
                      ? "bg-red-50/50 dark:bg-red-950/20"
                      : weekend
                        ? "bg-muted/20"
                        : ""
                  }`}
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
              className="absolute top-0 w-0.5 bg-red-500 z-10 pointer-events-none"
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
                  className="border-b bg-muted/10"
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
                className="border-b relative"
                style={{ height: ROW_HEIGHT }}
              >
                {bar && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className="absolute top-2 h-5 rounded-md cursor-default transition-opacity hover:opacity-80"
                        style={{
                          left: bar.left,
                          width: bar.width,
                          backgroundColor: color,
                          opacity: 0.85,
                        }}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-medium">{row.task.title}</p>
                      <p className="text-xs text-muted-foreground">
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
