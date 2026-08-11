// Display config for task status + priority (label, color classes).
//
// Hanya token semantik — tidak ada warna literal. Setiap pasangan
// teks/background di bawah ada di daftar yang sudah diukur di tokens.css:
// --warning/--warning-subtle, --success/--success-subtle, --text-muted/
// --surface-sunken. Warna tidak pernah jadi satu-satunya pembawa makna:
// setiap badge membawa label teks, dan titiknya aria-hidden.

import type { TaskPriority, TaskStatus } from "./types";

export const TASK_STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; dot: string; badge: string }
> = {
  // "To do" adalah keadaan default dan paling banyak jumlahnya — ia yang
  // paling tenang, supaya yang sedang berjalan dan yang selesai bisa terbaca.
  todo: {
    label: "To do",
    dot: "bg-text-muted",
    badge: "bg-surface-sunken text-text-muted",
  },
  in_progress: {
    label: "In progress",
    dot: "bg-warning",
    badge: "bg-warning-subtle text-warning",
  },
  done: {
    label: "Done",
    dot: "bg-success",
    badge: "bg-success-subtle text-success",
  },
  cancelled: {
    label: "Cancelled",
    dot: "bg-text-subtle",
    badge: "bg-surface-sunken text-text-muted line-through",
  },
};

export const TASK_PRIORITY_CONFIG: Record<
  TaskPriority,
  { label: string; className: string }
> = {
  // Prioritas naik lewat warna DAN weight — bukan warna saja. "None" dan
  // "Low" sengaja tidak berwarna: memberi kelimanya warna sendiri membuat
  // "Urgent" berhenti terbaca sebagai kekecualian (aturan 4).
  none: { label: "None", className: "text-text-subtle" },
  low: { label: "Low", className: "text-text-muted" },
  medium: { label: "Medium", className: "text-text font-medium" },
  high: { label: "High", className: "text-warning font-semibold" },
  urgent: { label: "Urgent", className: "text-danger font-semibold" },
};
