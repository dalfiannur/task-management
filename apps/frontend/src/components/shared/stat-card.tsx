import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Satu angka + label, dipakai baris statistik dashboard DAN tab Overview.
 *
 *  Hanya varian `alert` yang berwarna penuh. Itu bukan selera: kalau setiap
 *  kartu punya ikon berwarna sendiri, tidak ada yang menonjol (aturan 4), dan
 *  dari empat angka ini cuma "Overdue" yang menuntut tindakan. Sisanya sengaja
 *  diredupkan ke `surface-sunken` + `text-muted`.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  alert = false,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
            alert
              ? "bg-danger-subtle text-danger"
              : "bg-surface-sunken text-text-muted",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <div
            className={cn(
              "text-num text-2xl font-semibold",
              alert ? "text-danger" : "text-text",
            )}
          >
            {value}
          </div>
          <div className="text-label">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
