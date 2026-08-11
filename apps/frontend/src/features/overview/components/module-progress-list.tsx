import type { ModuleProgress } from "../types";

/** Per-module completion bars.
 *
 *  Bentuknya sengaja sama persis dengan daftar "Per project" di dashboard
 *  (`stat-cards.tsx`): track `surface-sunken`, isi `bg-brand`, angka `text-num`
 *  di kanan. Dua daftar progres yang menjawab pertanyaan sejenis tidak boleh
 *  punya dua bahasa visual.
 *
 *  Module tanpa task tetap ditampilkan sebagai 0/0 — backend mengirimnya. Bar
 *  kosong di sini informatif ("module ini belum diisi"), bukan noise. */
export function ModuleProgressList({ modules }: { modules: ModuleProgress[] }) {
  if (modules.length === 0) return null;

  return (
    /* Ruang di atas heading > di bawahnya (aturan 7): heading milik daftar
       yang mengikutinya, bukan blok di atasnya. */
    <div className="pt-2">
      <h3 className="text-label mb-3">Per module</h3>
      <ul className="space-y-3">
        {modules.map((m) => {
          const pct = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
          return (
            <li key={m.moduleId}>
              <div className="flex items-center justify-between text-sm">
                <span className="truncate font-medium">{m.moduleName}</span>
                <span className="text-num text-text-muted">
                  {m.done}/{m.total}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
