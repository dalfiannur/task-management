import type { Label } from "../types";

/** Small colored label chip. Uses the label color at low alpha for the bg. */
export function LabelChip({ label }: { label: Label }) {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${label.color}22`, color: label.color }}
    >
      {label.name}
    </span>
  );
}

/** Resolve + render a task's label ids as chips. */
export function LabelChips({
  ids,
  labelMap,
  max,
}: {
  ids: string[];
  labelMap: Record<string, Label>;
  max?: number;
}) {
  const labels = ids.map((id) => labelMap[id]).filter(Boolean);
  if (labels.length === 0) return null;
  const shown = max ? labels.slice(0, max) : labels;
  const extra = labels.length - shown.length;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((l) => (
        <LabelChip key={l.id} label={l} />
      ))}
      {extra > 0 && (
        <span className="text-xs text-muted-foreground">+{extra}</span>
      )}
    </span>
  );
}
