import type { Activity as PbActivity } from "@/lib/gen/activity_pb";
import { EntityType, ActivityAction as PbAction } from "@/lib/gen/activity_pb";
import type { Activity, ActivityAction, ActivityEntity } from "../types";

function mapEntity(t: EntityType): ActivityEntity {
  switch (t) {
    case EntityType.TASK:
      return "task";
    case EntityType.MODULE:
      return "module";
    case EntityType.MEMBERSHIP:
      return "membership";
    case EntityType.OWNERSHIP:
      return "ownership";
    case EntityType.PAGE:
      return "page";
    case EntityType.MEDIA:
      return "media";
    default:
      return "other";
  }
}

function mapAction(a: PbAction): ActivityAction {
  switch (a) {
    case PbAction.CREATED:
      return "created";
    case PbAction.UPDATED:
      return "updated";
    case PbAction.DELETED:
      return "deleted";
    default:
      return "other";
  }
}

export function mapActivity(a: PbActivity): Activity {
  return {
    id: a.id,
    projectId: a.projectId,
    actorId: a.actorId,
    entity: mapEntity(a.entityType),
    entityId: a.entityId,
    action: mapAction(a.action),
    summary: a.summary,
    changes: a.changes.map((c) => ({ field: c.field, from: c.from, to: c.to })),
    createdAt: a.createdAt,
  };
}
