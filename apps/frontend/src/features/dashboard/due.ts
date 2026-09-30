// Deadline wording shared by the dashboard lists.
//
// "Overdue" follows the server's rule — due before today in UTC — so the list
// and the Overdue count never disagree. Everything else reads in local time,
// because "Today"/"Tomorrow" is what the user's clock says.

import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";

export type DueGroup = "overdue" | "today" | "tomorrow" | "later";

const localIso = (d: Date) => format(d, "yyyy-MM-dd");
const utcToday = () => new Date().toISOString().slice(0, 10);

export function dueGroup(due: string, now = new Date()): DueGroup {
  if (due < utcToday()) return "overdue";
  const today = localIso(now);
  if (due <= today) return "today";
  if (due === localIso(addDays(now, 1))) return "tomorrow";
  return "later";
}

/** Short label for a due date: "3d late", "Today", "Tomorrow", "Fri 3 Oct". */
export function dueLabel(due: string, now = new Date()): string {
  const days = differenceInCalendarDays(parseISO(due), now);
  switch (dueGroup(due, now)) {
    case "overdue":
      return days < 0 ? `${-days}d late` : "Late";
    case "today":
      return "Today";
    case "tomorrow":
      return "Tomorrow";
    default:
      return format(parseISO(due), "EEE d MMM");
  }
}
