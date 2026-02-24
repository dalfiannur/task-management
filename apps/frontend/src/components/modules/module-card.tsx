import { useNavigate } from "react-router";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Boxes } from "lucide-react";
import type { Module } from "@/types/task";
import styles from "./module-card.module.css";

interface ModuleCardProps {
  module: Module;
  projectId: string;
}

export function ModuleCard({ module, projectId }: ModuleCardProps) {
  const navigate = useNavigate();

  return (
    <Card
      className={styles.card}
      onClick={() =>
        navigate(`/projects/${projectId}`)
      }
    >
      <CardHeader>
        <div className={styles.headerRow}>
          <div className={styles.infoGroup}>
            <CardTitle className={styles.title}>{module.name}</CardTitle>
            {module.description && (
              <CardDescription>{module.description}</CardDescription>
            )}
          </div>
          <Boxes className={styles.icon} />
        </div>
      </CardHeader>
    </Card>
  );
}
