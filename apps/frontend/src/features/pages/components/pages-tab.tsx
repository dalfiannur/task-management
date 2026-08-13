import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import { usePages, useCreatePage } from "../api/hooks";
import { PageEditor } from "./page-editor";

/** Master-detail wiki: page list (left) + editor (right). Member-gated.
 *  Selection lives in the URL (`page` search param) so a page is a
 *  shareable/deep-linkable address, not just local UI state. */
export function PagesTab({
  projectId,
  selectedId,
}: {
  projectId: string;
  selectedId?: string;
}) {
  const { pages, isLoading } = usePages(projectId);
  const create = useCreatePage();
  const navigate = useNavigate();

  function setSelected(id: string | null) {
    navigate({ to: ".", search: (prev) => ({ ...prev, page: id ?? undefined }) });
  }

  // Default selection → first page; clear/reselect when the selected page
  // disappears (deleted) or a deep-linked id doesn't exist in this project.
  // Guarded so it only navigates when the URL genuinely needs to change —
  // an effect that always calls setSelected would navigate every render.
  useEffect(() => {
    if (pages.length === 0) {
      if (selectedId) setSelected(null);
    } else if (!selectedId || !pages.some((p) => p.id === selectedId)) {
      setSelected(pages[0].id);
    }
    // setSelected intentionally excluded: it's derived from stable
    // primitives each render, and including it would navigate on every
    // render rather than only when pages/selectedId genuinely change.
  }, [pages, selectedId]);

  const selected = pages.find((p) => p.id === selectedId) ?? null;

  function newPage() {
    create.mutate(
      { projectId },
      {
        onSuccess: (page) => setSelected(page.id),
        onError: (e) => toast.error(e.message || "Failed to create page"),
      },
    );
  }

  if (isLoading) {
    return (
      <div className="p-6">
        {/* Bentuk skeleton mengikuti bentuk kartu yang akan menggantikannya —
            tinggi, radius, dan bayangan yang sama, supaya tidak ada lompatan
            layout saat data masuk. `rounded-xl` di sini baru benar-benar
            berlaku sejak radius dikeluarkan dari skeleton.module.css; sebelum
            itu ia dikalahkan diam-diam dan merender 8px. */}
        <Skeleton className="h-[calc(100vh-17rem)] min-h-[28rem] w-full rounded-xl shadow-2" />
      </div>
    );
  }

  // `selected` HANYA bisa null saat pages.length === 0 — efek di atas selalu
  // memilih pages[0] begitu daftarnya ada isinya. Artinya "No page selected."
  // yang dulu menghuni pane kanan tidak pernah bisa muncul berdampingan dengan
  // daftar terisi: ia dan "No pages yet." adalah keadaan yang sama persis,
  // ditulis dua kali. Satu empty state menggantikan keduanya.
  if (pages.length === 0) {
    return (
      <div className="p-6">
        {/* TANPA tinggi tetap, berbeda dari state terisi di bawah. Kartu
            setinggi viewport yang isinya satu paragraf di tengah membingkai
            kekosongan alih-alih menjelaskannya — ia membuat ketiadaan halaman
            terasa seperti kegagalan memuat. Kartu menyusut mengikuti isinya.

            Daftar halaman ikut dilepas, bukan dikosongkan: ia navigasi untuk
            konten yang belum ada, dan tombol "+"-nya menduplikasi CTA di sini
            (empty-states.md §3 — kontrol mati yang menutupi satu-satunya aksi). */}
        <div className="rounded-xl bg-surface-raised shadow-2">
          <EmptyState
            icon={FileText}
            title="No pages yet"
            body="Pages are where a project writes things down — specs, decisions, meeting notes, anything the team needs to find again later."
            // actionSlot, bukan action: CTA ini perlu disabled selama request
            // create berjalan. Gaya tetap primer (variant default) — di layar
            // kosong ia satu-satunya aksi yang ada.
            actionSlot={
              <Button onClick={newPage} disabled={create.isPending}>
                <Plus className="mr-1 h-4 w-4" />
                {create.isPending ? "Creating…" : "Write the first page"}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  // Tanpa garis atas: segmented control di atasnya menambatkan dirinya
  // sendiri, dan aturan chrome desain ini melarang rule antar-region.
  return (
    /* Split-pane duduk di dalam SATU kartu raised, bukan rata di kanvas.
       Ini yang membuat `border-border-subtle` di bawah sah: tokens.css
       mendefinisikannya sebagai hairline pemisah DI DALAM permukaan raised.
       Di kanvas ia grey-100 di atas grey-50 — 1.07:1 di light, pemisah yang
       secara efektif tidak ada.

       17rem, bukan 14rem seperti sebelumnya: pembungkus p-6 menambah 3rem
       (24px atas + 24px bawah) di luar kartu. 28rem min-height dipertahankan
       dari versi lama — ia lantai untuk viewport pendek, bukan spacing antar
       elemen, jadi berada di luar skala spacing memang disengaja.

       overflow-hidden wajib: daftar halaman menggulir sendiri, dan tanpa ini
       ia menabrak keluar sudut membulat kartu. */
    <div className="p-6">
      <div className="flex h-[calc(100vh-17rem)] min-h-[28rem] overflow-hidden rounded-xl bg-surface-raised shadow-2">
        <aside className="flex w-64 shrink-0 flex-col border-r border-border-subtle">
          <div className="flex items-center justify-between p-2">
            <span className="px-2 text-sm font-medium text-text-muted">
              Pages
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={newPage}
              disabled={create.isPending}
              aria-label="New page"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {/* Tanpa cabang kosong: daftar ini hanya dirender saat pages.length > 0
              — kasus nol sudah ditangani empty state di atas. */}
          <ul className="flex-1 overflow-y-auto px-1">
            {pages.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelected(p.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
                    "transition-colors [transition-duration:var(--duration-fast)]",
                    p.id === selectedId
                      ? "bg-surface-sunken font-medium"
                      : "hover:bg-surface-hover",
                  )}
                >
                  <span className="w-5 text-center">
                    {p.icon || <FileText className="h-4 w-4 opacity-60" />}
                  </span>
                  <span className="flex-1 truncate">
                    {p.title || "Untitled"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* min-w-0: judul halaman yang panjang dulu boleh mendorong pane ini
            melebar. Sekarang kartunya overflow-hidden, jadi dorongan itu tidak
            lagi melebarkan layout — ia terpotong diam-diam. Nol-kan basis flex
            supaya truncate di dalam editor yang bekerja.

            `selected` di sini praktis selalu terisi; ia null hanya pada satu
            frame sebelum efek pemilih-default jalan. Membiarkan frame itu
            kosong lebih jujur daripada mengedipkan pesan "tidak ada yang
            dipilih" untuk keadaan yang bertahan ~16ms. */}
        <div className="min-w-0 flex-1">
          {selected && (
            <PageEditor
              key={selected.id}
              page={selected}
              onDeleted={() => setSelected(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
