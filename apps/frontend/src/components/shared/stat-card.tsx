import type { LucideIcon } from "lucide-react";
import { StatCard as BaseStatCard } from "sedjiwa-ui";

/** Satu angka + label, dipakai baris statistik dashboard DAN tab Overview.
 *
 *  Hanya varian `alert` yang berwarna penuh. Itu bukan selera: kalau setiap
 *  kartu punya ikon berwarna sendiri, tidak ada yang menonjol (aturan 4), dan
 *  dari empat angka ini cuma "Overdue" yang menuntut tindakan. Sisanya sengaja
 *  netral.
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
    <BaseStatCard
      icon={<Icon />}
      label={label}
      value={<span className="text-num">{value}</span>}
      tone={alert ? "destructive" : "neutral"}
    />
  );
}
