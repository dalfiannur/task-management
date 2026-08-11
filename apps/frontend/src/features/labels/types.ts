// Flat FE type for the labels domain, mapped from gen/labels_pb.

export interface Label {
  id: string;
  projectId: string;
  name: string;
  color: string; // #RRGGBB
}

/** Preset palette offered in the color picker.
 *
 *  Satu-satunya warna literal yang sengaja dibiarkan di luar `tokens.css`:
 *  nilai-nilai ini adalah DATA yang dikirim ke backend dan disimpan per label
 *  (`Label.color`), bukan warna tema. Memindahkannya jadi CSS variable akan
 *  memutus round-trip ke API. Warna ini hanya dipakai untuk titik penanda
 *  (lihat `LabelChip`) — tidak pernah jadi warna teks, justru karena kontras
 *  warna pilihan user tidak bisa dijamin. */
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
