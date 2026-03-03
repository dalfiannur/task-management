export type ClassValue = string | undefined | null | false;

export function cn(...inputs: ClassValue[]): string {
  return inputs.filter(Boolean).join(" ");
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
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
