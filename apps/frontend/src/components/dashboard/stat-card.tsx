import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import styles from "./stat-card.module.css";

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
      className={styles.card}
      style={{ borderLeftColor: accentColor }}
    >
      <CardContent className={styles.content}>
        <div className={styles.layout}>
          <div className={styles.textGroup}>
            <p className={styles.title}>
              {title}
            </p>
            <p
              className={styles.value}
              style={{ color: accentColor }}
            >
              {value}
            </p>
            {description && (
              <p className={styles.description}>
                {description}
              </p>
            )}
          </div>
          <div
            className={styles.iconWrapper}
            style={{ backgroundColor: `${accentColor}14` }}
          >
            <Icon className={styles.icon} style={{ color: accentColor }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
