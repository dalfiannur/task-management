// Flat FE type for the labels domain, mapped from gen/labels_pb.

export interface Label {
  id: string;
  projectId: string;
  name: string;
  color: string; // #RRGGBB
}

/** Preset palette offered in the color picker. */
export const LABEL_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#64748b",
];
