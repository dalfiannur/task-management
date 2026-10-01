import { format, formatDistanceToNow, parseISO } from "date-fns";

/** "3 hours ago", or "" for a missing/unparseable timestamp. */
export function editedAgo(iso: string) {
  if (!iso) return "";
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

/** "1 Oct 2026", or "" for a missing/unparseable timestamp. */
export function formatDate(iso: string) {
  if (!iso) return "";
  try {
    return format(parseISO(iso), "d MMM yyyy");
  } catch {
    return "";
  }
}
