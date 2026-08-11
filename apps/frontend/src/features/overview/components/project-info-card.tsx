import type { ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";
import { ProjectStatusBadge } from "@/features/projects";
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
 *  Ini BUKAN pengulangan header detail project. Header menjawab "project apa
 *  ini" (nama, deskripsi, owner, rentang tanggal); panel ini menjawab "isinya
 *  seberapa banyak" — status, jumlah module/page/media, dan wajah anggotanya.
 *  Owner dan tanggal tetap muncul karena di dalam kartu ini keduanya adalah
 *  atribut yang sedang dibandingkan, bukan judul halaman.
 *
 *  Status/owner/tanggal datang dari `project` (cache-nya sudah panas dari
 *  shell); angka dan `memberIds` datang dari RPC overview. */
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

  const range =
    project.startDate || project.endDate
      ? `${project.startDate ?? "…"} → ${project.endDate ?? "…"}`
      : "No dates set";

  return (
    <div className="rounded-xl bg-surface-raised p-4 shadow-2">
      <h3 className="text-label mb-2">About</h3>
      {/* Sekat pakai border-subtle, bukan border: di dalam permukaan raised
          `--border` terbaca sebagai jahitan (lihat catatan di members-tab). */}
      <div className="divide-y divide-border-subtle">
        <Row label="Status">
          <ProjectStatusBadge status={project.status} />
        </Row>

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
                  className="-ml-2 h-7 w-7 ring-2 ring-surface-raised first:ml-0"
                  title={name}
                >
                  {u?.avatarUrl && <AvatarImage src={u.avatarUrl} />}
                  <AvatarFallback className="text-xs">
                    {getInitials(name)}
                  </AvatarFallback>
                </Avatar>
              );
            })}
            {rest > 0 && (
              <span className="text-num ml-2 text-xs text-text-muted">
                +{rest}
              </span>
            )}
          </span>
        </Row>
      </div>
    </div>
  );
}
