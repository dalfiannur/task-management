import type { Label as PbLabel } from "@/lib/gen/labels_pb";
import type { Label } from "../types";

export function mapLabel(l: PbLabel): Label {
  return {
    id: l.id,
    projectId: l.projectId,
    name: l.name,
    color: l.color,
  };
}
