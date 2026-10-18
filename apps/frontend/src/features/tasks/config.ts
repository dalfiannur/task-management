// Display config for task status + priority (label, color classes).
//
// Hanya token semantik — tidak ada warna literal. Setiap pasangan
// teks/background di bawah ada di daftar yang sudah diukur di tokens.css:
// --warning/--warning-subtle, --success/--success-subtle, --text-muted/
// --surface-sunken. Warna tidak pernah jadi satu-satunya pembawa makna:
// setiap badge membawa label teks, dan titiknya aria-hidden.

import type { Task, TaskPriority, TaskStatus } from "./types";

export const TASK_STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; dot: string; badge: string }
> = {
  // "To do" adalah keadaan default dan paling banyak jumlahnya — ia yang
  // paling tenang, supaya yang sedang berjalan dan yang selesai bisa terbaca.
  todo: {
    label: "To do",
    dot: "bg-muted-foreground",
    badge: "bg-muted text-muted-foreground",
  },
  in_progress: {
    label: "In progress",
    dot: "bg-warning",
    badge: "bg-warning-subtle text-warning-text",
  },
  done: {
    label: "Done",
    dot: "bg-success",
    badge: "bg-success-subtle text-success-text",
  },
  cancelled: {
    label: "Cancelled",
    dot: "bg-muted-foreground",
    badge: "bg-muted text-muted-foreground line-through",
  },
};

export const TASK_PRIORITY_CONFIG: Record<
  TaskPriority,
  { label: string; className: string }
> = {
  // Prioritas naik lewat warna DAN weight — bukan warna saja. "None" dan
  // "Low" sengaja tidak berwarna: memberi kelimanya warna sendiri membuat
  // "Urgent" berhenti terbaca sebagai kekecualian (aturan 4).
  none: { label: "None", className: "text-muted-foreground" },
  low: { label: "Low", className: "text-muted-foreground" },
  medium: { label: "Medium", className: "text-foreground font-medium" },
  high: { label: "High", className: "text-warning-text font-semibold" },
  urgent: { label: "Urgent", className: "text-destructive font-semibold" },
};

/** A task's status as shown: its workflow name, else its category's. */
export function statusLabel(task: Pick<Task, "status" | "statusName">): string {
  return task.statusName || TASK_STATUS_CONFIG[task.status].label;
}
