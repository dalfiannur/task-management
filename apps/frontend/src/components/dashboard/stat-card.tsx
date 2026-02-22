import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface StatCardProps {
  title: string;
  value: number;
  icon: LucideIcon;
  description?: string;
  accentColor: string;
}

export function StatCard({
  title,
  value,
  icon: Icon,
  description,
  accentColor,
}: StatCardProps) {
  return (
    <Card
      className="overflow-hidden border-l-[3px] py-0 transition-shadow hover:shadow-md"
      style={{ borderLeftColor: accentColor }}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {title}
            </p>
            <p
              className="text-4xl font-extrabold font-display tracking-tight"
              style={{
                color: accentColor,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {value}
            </p>
            {description && (
              <p className="text-[11px] text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          <div
            className="rounded-xl p-2.5"
            style={{ backgroundColor: `${accentColor}14` }}
          >
            <Icon className="size-5" style={{ color: accentColor }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
