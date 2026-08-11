import type { LucideIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Aksi tunggal untuk empty state. Bisa tombol atau navigasi. */
export type EmptyStateAction =
  | { label: string; onClick: () => void }
  | { label: string; to: string; params?: Record<string, string> };

/**
 * Empty state — `ui-design` aturan 9 + `references/empty-states.md`.
 *
 * Empat elemen wajib, semuanya bukan opsional: ikon, headline yang menjelaskan
 * APA yang akan muncul di sini (bukan "Kosong"), satu kalimat pendukung, dan
 * TEPAT SATU CTA bergaya PRIMER. CTA-nya primer bukan karena selera: di layar
 * kosong ia satu-satunya aksi yang ada, jadi menggayakannya sekunder berarti
 * meredupkan satu-satunya hal penting di layar.
 *
 * Tiga keadaan kosong sengaja dibedakan (§4) — satu komponen dengan satu copy
 * untuk ketiganya selalu salah untuk dua di antaranya:
 *   first-run  → belum pernah ada isi. Nada onboarding, CTA membuat item pertama.
 *   no-results → filter/pencarian nol hasil. CTA MENGHAPUS FILTER, bukan "buat baru".
 *   cleared    → sudah dikosongkan user. Nada menenangkan.
 */
export function EmptyState({
  variant = "first-run",
  icon: Icon,
  title,
  body,
  action,
  actionSlot,
  size = "default",
  className,
}: {
  variant?: "first-run" | "no-results" | "cleared";
  icon: LucideIcon;
  title: string;
  body: string;
  /** Dihilangkan hanya kalau user memang tidak punya izin untuk mengisinya. */
  action?: EmptyStateAction;
  /** Untuk aksi yang membawa UI sendiri (mis. dialog trigger). Yang ditaruh
   *  di sini WAJIB bergaya primer — lihat empty-states.md §2. */
  actionSlot?: React.ReactNode;
  size?: "default" | "compact";
  className?: string;
}) {
  const compact = size === "compact";
  return (
    <div
      data-variant={variant}
      className={cn(
        "mx-auto flex max-w-md flex-col items-center text-center",
        // Mulai longgar, lalu dikurangi — aturan 8.
        compact ? "px-4 py-8" : "px-6 py-16",
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          // Diredupkan: ia konteks, bukan aksi.
          "text-text-subtle",
          compact ? "mb-3 h-8 w-8" : "mb-6 h-16 w-16",
        )}
        strokeWidth={1.5}
      />
      {/* Margin kecil: judul + kalimat pendukung adalah satu grup. */}
      <p
        className={cn(
          "mb-2 font-semibold text-text",
          compact ? "text-sm" : "text-xl",
        )}
      >
        {title}
      </p>
      {/* Jarak antar-grup > dalam-grup (aturan 7), jadi CTA duduk lebih jauh. */}
      <p
        className={cn(
          "max-w-[32ch] text-text-muted",
          compact ? "mb-4 text-xs" : "mb-6 text-sm",
        )}
      >
        {body}
      </p>
      {actionSlot}
      {!actionSlot && action && (
        <Button
          // PRIMER — bukan secondary, bukan ghost.
          size={compact ? "sm" : "default"}
          asChild={"to" in action}
          {...("onClick" in action ? { onClick: action.onClick } : {})}
        >
          {"to" in action ? (
            <Link to={action.to} params={action.params}>
              {action.label}
            </Link>
          ) : (
            action.label
          )}
        </Button>
      )}
    </div>
  );
}
