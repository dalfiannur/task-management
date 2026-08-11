import type { ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";
import { formatProjectDateRange } from "@/features/projects";
import type { Project } from "@/features/projects";
import { useUserMap } from "@/features/users";
import type { ProjectOverview } from "../types";

/** Berapa avatar yang ditampilkan sebelum sisanya diringkas jadi "+N". */
const MAX_FACES = 5;

/** Tidak ada helper pluralize lain di codebase ini — "1 modules" salah baca,
 *  jadi ditambahkan di sini daripada dibiarkan salah. */
function pluralize(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <span className="text-label shrink-0">{label}</span>
      <div className="min-w-0 text-right text-sm">{children}</div>
    </div>
  );
}

/** Panel "About".
 *
 *  Header detail project menjawab "project apa ini"; panel ini menjawab "isinya
 *  seberapa banyak" — jumlah module/page/media dan wajah anggotanya.
 *
 *  Baris Status sengaja TIDAK ada di sini. Header sudah merender
 *  `ProjectStatusBadge` beberapa ratus piksel di atas, dan pada viewport
 *  pendaratan keduanya terlihat sekaligus — badge yang sama muncul dua kali
 *  dengan bobot sama, persis kegagalan "kalau semua menonjol, tidak ada yang
 *  menonjol". Owner dan tanggal tetap tinggal: keduanya jauh lebih tenang
 *  secara visual dan masih berguna ketika header sudah ter-scroll ke atas.
 *
 *  Owner/tanggal datang dari `project` (cache-nya sudah panas dari shell);
 *  angka dan `memberIds` datang dari RPC overview. */
export function ProjectInfoCard({
  project,
  overview,
}: {
  project: Project;
  overview: ProjectOverview;
}) {
  const userMap = useUserMap();
  const owner = userMap[project.ownerId];
  const ownerName = owner?.displayName ?? "Owner";

  const faces = overview.memberIds.slice(0, MAX_FACES);
  const rest = overview.memberIds.length - faces.length;

  const range = formatProjectDateRange(project) ?? "No dates set";

  return (
    <div className="rounded-xl bg-surface-raised p-4 shadow-2">
      <h2 className="text-label mb-3">About</h2>
      {/* Sekat pakai border-subtle, bukan border: di dalam permukaan raised
          `--border` terbaca sebagai jahitan (lihat catatan di members-tab). */}
      <div className="divide-y divide-border-subtle">
        <Row label="Owner">
          <span className="flex items-center justify-end gap-2">
            <Avatar className="h-6 w-6">
              {owner?.avatarUrl && <AvatarImage src={owner.avatarUrl} />}
              <AvatarFallback className="text-xs">
                {getInitials(ownerName)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{ownerName}</span>
          </span>
        </Row>

        <Row label="Dates">
          <span className="text-num text-text-muted">{range}</span>
        </Row>

        <Row label="Contents">
          <span className="text-num text-text-muted">
            {pluralize(overview.moduleCount, "module")} ·{" "}
            {pluralize(overview.pageCount, "page")} · {overview.mediaCount}{" "}
            media
          </span>
        </Row>

        <Row label={`Members (${overview.memberIds.length})`}>
          {/* Avatar bertumpuk: ring memakai warna kartu, jadi tumpukannya
              terbaca sebagai satu grup, bukan lingkaran yang saling memotong. */}
          <span className="flex items-center justify-end">
            {faces.map((id) => {
              const u = userMap[id];
              const name = u?.displayName ?? id;
              return (
                <Avatar
                  key={id}
                  className="-ml-2 h-6 w-6 ring-2 ring-surface-raised first:ml-0"
                  title={name}
                >
                  {u?.avatarUrl && <AvatarImage src={u.avatarUrl} alt="" />}
                  <AvatarFallback className="text-xs" aria-hidden="true">
                    {getInitials(name)}
                  </AvatarFallback>
                  <span className="sr-only">{name}</span>
                </Avatar>
              );
            })}
            {rest > 0 && (
              <span className="text-num ml-2 text-xs text-text-muted">
                +{rest}
                <span className="sr-only"> more members</span>
              </span>
            )}
          </span>
        </Row>
      </div>
    </div>
  );
}
