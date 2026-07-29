import type { Page as PbPage } from "@/lib/gen/pages_pb";
import type { Page } from "../types";

export function mapPage(p: PbPage): Page {
  return {
    id: p.id,
    projectId: p.projectId,
    title: p.title,
    icon: p.icon,
    content: p.content,
    order: p.order,
    createdBy: p.createdBy,
    lastEditedBy: p.lastEditedBy,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
