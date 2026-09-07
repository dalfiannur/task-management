import { useAtomValue } from "jotai";
import { format } from "date-fns";
import { currentUserAtom } from "@/features/auth";
import { APP_NAME } from "@/lib/app-config";
import type { PeriodWindow } from "../types";

/** Print-only masthead. A sheet that leaves the app has to say what it is, what
 *  period it covers, and when it was taken — otherwise it is a page of numbers
 *  with no provenance. */
export function ReportPrintHeader({ window }: { window: PeriodWindow }) {
  const user = useAtomValue(currentUserAtom);
  return (
    <header className="hidden border-b border-border pb-4 print:block">
      <h1 className="text-xl font-semibold">
        {window.granularity === "weekly" ? "Weekly" : "Monthly"} report
      </h1>
      <p className="text-num text-sm text-text-muted">{window.label}</p>
      <p className="mt-1 text-xs text-text-subtle">
        {APP_NAME} · printed {format(new Date(), "d MMM yyyy HH:mm")}
        {user?.displayName ? ` · ${user.displayName}` : ""}
      </p>
    </header>
  );
}
