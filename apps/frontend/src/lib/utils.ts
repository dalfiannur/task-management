import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Normalize a TanStack Router search param that may arrive as a `string`,
 * a `number` (the router JSON-parses raw search values, so an unquoted
 * numeric id like `?task=3688` parses to the number `3688`, not a string),
 * or anything else — into a `string`, or `undefined` for genuinely
 * absent/empty values. Use this in `validateSearch` instead of a bare
 * `typeof x === "string"` guard, which silently drops numeric-looking ids.
 */
export function coerceSearchParam(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() === "" ? undefined : value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveDisplayName(
  userId: string,
  storedName: string,
  users: Array<{ id: string; name: string }>,
): string {
  const user = users.find((u) => u.id === userId);
  if (user?.name && !UUID_RE.test(user.name)) return user.name;
  if (storedName && !UUID_RE.test(storedName)) return storedName;
  return "Unknown user";
}
