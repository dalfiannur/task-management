import { formatMinutes } from "@/lib/duration";
import type { ProjectContents } from "../api/hooks";

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** "48 tasks · 120h logged · 15 files (230 MB) · 3 pages", zeros left out. */
export function describeContents(c: ProjectContents): string {
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const parts: string[] = [];
  if (c.tasks) parts.push(n(c.tasks, "task"));
  if (c.timeMinutes) parts.push(`${formatMinutes(c.timeMinutes)} logged`);
  if (c.mediaFiles) parts.push(`${n(c.mediaFiles, "file")} (${bytes(c.mediaBytes)})`);
  if (c.pages) parts.push(n(c.pages, "page"));
  if (c.comments) parts.push(n(c.comments, "comment"));
  if (c.modules) parts.push(n(c.modules, "module"));
  if (c.automations) parts.push(n(c.automations, "automation"));
  return parts.length ? parts.join(" · ") : "Empty";
}
