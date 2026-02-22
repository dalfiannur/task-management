import { useNavigate } from "@tanstack/react-router";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Boxes } from "lucide-react";
import type { Module } from "@/types/task";

interface ModuleCardProps {
  module: Module;
  projectId: string;
}

export function ModuleCard({ module, projectId }: ModuleCardProps) {
  const navigate = useNavigate();

  return (
    <Card
      className="cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={() =>
        navigate({
          to: "/projects/$projectId",
          params: { projectId },
        })
      }
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">{module.name}</CardTitle>
            {module.description && (
              <CardDescription>{module.description.replace(/<[^>]*>/g, "")}</CardDescription>
            )}
          </div>
          <Boxes className="size-5 text-muted-foreground shrink-0" />
        </div>
      </CardHeader>
    </Card>
  );
}
