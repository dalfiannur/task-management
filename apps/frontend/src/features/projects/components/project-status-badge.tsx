import { Badge } from "@/components/ui/badge";
import type { ProjectStatus } from "../types";
import { STATUS_LABEL } from "../types";

const VARIANT: Record<ProjectStatus, "default" | "secondary" | "outline"> = {
  active: "default",
  completed: "secondary",
  archived: "outline",
  unspecified: "outline",
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge variant={VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}
