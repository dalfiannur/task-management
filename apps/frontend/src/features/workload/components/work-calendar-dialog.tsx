import { useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  Switch,
} from "sedjiwa-ui";
import { cn } from "@/lib/utils";
import { scopeToProto } from "../api/mappers";
import { useSetWorkCalendar, useWorkCalendar } from "../api/hooks";
import { formatDays, WEEKDAYS, type CalendarScope, type WorkCalendar } from "../types";

const DESCRIPTION: Record<CalendarScope, string> = {
  global:
    "The working days every project and person uses unless they set their own, and the time zone that decides what \"today\" is everywhere.",
  project:
    "Days this project's work is planned on. Effort is spread over the days both the project and the assignee work.",
  user: "Days and hours this person works. Weekly hours set their capacity.",
};

function DayToggles({
  days,
  disabled,
  onChange,
}: {
  days: number[];
  disabled: boolean;
  onChange: (days: number[]) => void;
}) {
  return (
    <div role="group" aria-label="Working days" className="flex flex-wrap gap-1.5">
      {WEEKDAYS.map(({ day, short, label }) => {
        const on = days.includes(day);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            aria-label={label}
            disabled={disabled}
            onClick={() =>
              onChange(on ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b))
            }
            className={cn(
              "h-9 w-12 rounded-md border text-sm font-medium",
              "[transition:background-color_var(--duration-fast)_var(--ease-out)]",
              "disabled:cursor-not-allowed disabled:opacity-50",
              on
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background text-muted-foreground hover:bg-accent",
            )}
          >
            {short}
          </button>
        );
      })}
    </div>
  );
}

/** The form, seeded once from the loaded calendar. */
function CalendarForm({
  calendar,
  onDone,
}: {
  calendar: WorkCalendar;
  onDone: () => void;
}) {
  const set = useSetWorkCalendar();
  const isGlobal = calendar.scope === "global";
  const isUser = calendar.scope === "user";
  const [inherit, setInherit] = useState(!isGlobal && calendar.workingDays.length === 0);
  const [days, setDays] = useState(calendar.effectiveDays);
  const [hours, setHours] = useState(
    calendar.weeklyMinutes !== undefined ? String(calendar.weeklyMinutes / 60) : "",
  );
  const readOnly = !calendar.canEdit;
  const [timezone, setTimezone] = useState(calendar.timezone ?? "");
  // The server's own list: the browser's differs (newer and legacy names).
  const zones = calendar.supportedTimezones;
  const zoneBad = isGlobal && timezone.trim() !== "" && !zones.includes(timezone.trim());

  const hoursValue = hours.trim() === "" ? undefined : Number(hours.replace(",", "."));
  const hoursBad =
    hoursValue !== undefined && (!Number.isFinite(hoursValue) || hoursValue < 0 || hoursValue > 168);
  const daysBad = !inherit && days.length === 0;

  function save() {
    set.mutate(
      {
        scope: scopeToProto(calendar.scope),
        id: calendar.id,
        workingDays: inherit ? [] : days,
        weeklyMinutes:
          isUser && hoursValue !== undefined ? Math.round(hoursValue * 60) : undefined,
        timezone: isGlobal ? timezone.trim() : undefined,
      },
      {
        onSuccess: () => {
          toast.success("Working days saved.");
          onDone();
        },
        onError: (e) => toast.error(e.message || "Failed to save"),
      },
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!readOnly && !daysBad && !hoursBad && !zoneBad) save();
      }}
    >
      {!isGlobal && (
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="cal-inherit" className="font-normal">
            Use the workspace default
          </Label>
          <Switch
            id="cal-inherit"
            checked={inherit}
            disabled={readOnly}
            onCheckedChange={(on) => {
              setInherit(on);
              if (!on && days.length === 0) setDays(calendar.effectiveDays);
            }}
          />
        </div>
      )}

      <div className="space-y-2">
        <Label>Working days</Label>
        {inherit ? (
          <p className="text-sm text-muted-foreground">
            {calendar.workingDays.length === 0
              ? `${formatDays(calendar.effectiveDays)} (workspace default)`
              : "Follows the workspace default."}
          </p>
        ) : (
          <DayToggles days={days} disabled={readOnly} onChange={setDays} />
        )}
        {daysBad && <p className="text-xs text-destructive">Pick at least one day.</p>}
      </div>

      {isGlobal && (
        <div className="space-y-2">
          <Label htmlFor="cal-tz">Time zone</Label>
          <Input.Root aria-invalid={zoneBad || undefined}>
            <Input.Field
              id="cal-tz"
              list="cal-tz-zones"
              value={timezone}
              disabled={readOnly}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="Asia/Jakarta"
              autoComplete="off"
            />
          </Input.Root>
          <datalist id="cal-tz-zones">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <p className={cn("text-xs", zoneBad ? "text-destructive" : "text-muted-foreground")}>
            {zoneBad
              ? "Pick a zone from the list, e.g. Asia/Jakarta."
              : "Decides what “today” is for time entries, the workload, overdue and automations. Blank uses Asia/Jakarta."}
          </p>
        </div>
      )}

      {isUser && (
        <div className="space-y-2">
          <Label htmlFor="cal-hours">Hours per week</Label>
          <Input.Root aria-invalid={hoursBad || undefined} className="w-32">
            <Input.Field
              id="cal-hours"
              inputMode="decimal"
              value={hours}
              disabled={readOnly}
              onChange={(e) => setHours(e.target.value)}
              placeholder={String(calendar.effectiveWeeklyMinutes / 60)}
            />
          </Input.Root>
          <p className={cn("text-xs", hoursBad ? "text-destructive" : "text-muted-foreground")}>
            {hoursBad ? "Between 0 and 168 hours." : "Blank uses the default of 40 hours."}
          </p>
        </div>
      )}

      <DialogFooter>
        {readOnly ? (
          <Button type="button" variant="outline" onClick={onDone}>
            Close
          </Button>
        ) : (
          <>
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={set.isPending || daysBad || hoursBad || zoneBad}>
              {set.isPending ? "Saving…" : "Save"}
            </Button>
          </>
        )}
      </DialogFooter>
    </form>
  );
}

/** View or edit one calendar: the workspace's, a project's or a person's. */
export function WorkCalendarDialog({
  scope,
  id = "",
  title,
  open,
  onOpenChange,
}: {
  scope: CalendarScope;
  id?: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { calendar, isLoading, isError, error } = useWorkCalendar(scope, id, open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{DESCRIPTION[scope]}</DialogDescription>
        </DialogHeader>
        {isError ? (
          <p className="text-sm text-destructive">{error?.message ?? "Failed to load."}</p>
        ) : isLoading || !calendar ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          // Keyed so reopening after a save re-seeds from the fresh calendar.
          <CalendarForm
            key={`${calendar.workingDays.join()}-${calendar.weeklyMinutes ?? ""}-${calendar.timezone ?? ""}`}
            calendar={calendar}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
