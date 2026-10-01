import type { ModuleProgress } from "../types";

/** Per-module completion bars.
 *
 *  Bentuknya sengaja sama dengan daftar "Projects" di dashboard
 *  (`project-progress-list.tsx`): track `surface-sunken`, isi `bg-brand`, angka
 *  `text-num` di kanan, satu baris keterangan kecil di bawah. Dua daftar
 *  progres yang menjawab pertanyaan sejenis tidak boleh punya dua bahasa visual.
 *
 *  Module tanpa task tetap ditampilkan sebagai 0/0 — backend mengirimnya. Bar
 *  kosong di sini informatif ("module ini belum diisi"), bukan noise.
 *
 *  `overdueByModule` dihitung di sisi klien dari daftar task project; module
 *  yang tidak ada di map dianggap nol overdue. */
export function ModuleProgressList({
  modules,
  overdueByModule,
}: {
  modules: ModuleProgress[];
  overdueByModule: ReadonlyMap<string, number>;
}) {
  if (modules.length === 0) return null;

  return (
    <ul>
      {modules.map((m) => {
        const pct = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
        const overdue = overdueByModule.get(m.moduleId) ?? 0;
        return (
          <li
            key={m.moduleId}
            className="border-b border-border-subtle px-4 py-3 last:border-b-0"
          >
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate font-medium">{m.moduleName}</span>
              <span className="text-num shrink-0 text-xs text-text-muted">
                {m.done}/{m.total}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-text-muted">
              {overdue > 0 ? (
                <span className="font-medium text-danger">
                  <span className="text-num">{overdue}</span> overdue
                </span>
              ) : m.total === 0 ? (
                "No tasks yet"
              ) : m.done === m.total ? (
                "Complete"
              ) : (
                <>
                  <span className="text-num">{pct}%</span> done
                </>
              )}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
