import { Link } from "@tanstack/react-router";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "⚡ <rule>": marks something an automation rule did, linking to the
 * project's Automations tab. A deleted rule reads "⚡ deleted rule".
 */
export function AutomationTag({
  projectId,
  name,
  className,
}: {
  projectId?: string;
  /** The rule's name; "" once it was deleted. */
  name: string;
  className?: string;
}) {
  const label = name || "deleted rule";
  const body = (
    <>
      <Zap aria-hidden="true" className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </>
  );
  const cls = cn(
    "inline-flex max-w-[16rem] items-center gap-1 rounded-full bg-info-subtle px-2 py-0.5 align-middle text-xs font-medium text-info-subtle-text",
    className,
  );
  if (!projectId || !name) {
    return (
      <span className={cls} title={`Done by the automation rule "${label}"`}>
        {body}
      </span>
    );
  }
  return (
    <Link
      to="/projects/$projectId/automations"
      params={{ projectId }}
      className={cn(cls, "hover:underline")}
      title={`Done by the automation rule "${label}"`}
      onClick={(e) => e.stopPropagation()}
    >
      {body}
    </Link>
  );
}
