import { cn } from "@/lib/utils";
import type { AutomationMode } from "../types";

const MODES: { mode: AutomationMode; label: string; hint: string }[] = [
  { mode: "off", label: "Off", hint: "Never runs" },
  { mode: "observe", label: "Observe", hint: "Logs what it would do, changes nothing" },
  { mode: "on", label: "On", hint: "Acts on tasks" },
];

/** Off / Observe / On as one segmented control. */
export function ModeControl({
  value,
  onChange,
  disabled,
  label,
  size = "sm",
}: {
  value: AutomationMode;
  onChange: (mode: AutomationMode) => void;
  disabled?: boolean;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex shrink-0 gap-0.5 rounded-full bg-muted p-[3px]"
    >
      {MODES.map((m) => {
        const on = value === m.mode;
        return (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={on}
            title={m.hint}
            disabled={disabled}
            onClick={() => !on && onChange(m.mode)}
            className={cn(
              "rounded-full font-medium disabled:cursor-not-allowed disabled:opacity-60",
              "[transition:background-color_var(--duration-fast)_var(--ease-out),color_var(--duration-fast)_var(--ease-out)]",
              size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm",
              on
                ? m.mode === "on"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : m.mode === "observe"
                    ? "bg-info-subtle text-info-subtle-text shadow-xs"
                    : "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
