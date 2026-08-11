import type { Label } from "../types";

/** Small label chip: warna label jadi TITIK penanda, bukan warna teksnya.
 *
 *  Sebelumnya chip memakai `color: label.color` di atas background warna yang
 *  sama beralpha 13%. Warna itu data pilihan user, jadi kontrasnya tidak bisa
 *  dijamin oleh nilai apa pun — label kuning menghasilkan teks kuning di atas
 *  permukaan nyaris putih. Nama label sekarang memakai token teks yang sudah
 *  diukur, dan warnanya tetap terbaca lewat titik di sebelahnya. Titiknya
 *  aria-hidden karena maknanya sudah dibawa nama label (accessibility §5). */
export function LabelChip({ label }: { label: Label }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-text">
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: label.color }}
      />
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
        <span className="text-xs text-text-muted">+{extra}</span>
      )}
    </span>
  );
}
