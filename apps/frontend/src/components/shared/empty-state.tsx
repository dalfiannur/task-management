import type { LucideIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button, EmptyState as BaseEmptyState } from "sedjiwa-ui";
import { cn } from "@/lib/utils";

/** Aksi tunggal untuk empty state. Bisa tombol atau navigasi. */
export type EmptyStateAction =
  | { label: string; onClick: () => void }
  | { label: string; to: string; params?: Record<string, string> };

const TONE = {
  "first-run": "default",
  "no-results": "muted",
  cleared: "success",
} as const;

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
 *
 * Tampilannya milik `EmptyState` sedjiwa-ui; keadaan dipetakan ke `tone`-nya.
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
  const cta =
    actionSlot ??
    (action && (
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
    ));
  return (
    <BaseEmptyState
      data-variant={variant}
      tone={TONE[variant]}
      icon={<Icon aria-hidden="true" />}
      title={title}
      description={body}
      action={cta || undefined}
      className={cn(compact && "py-8", className)}
    />
  );
}
