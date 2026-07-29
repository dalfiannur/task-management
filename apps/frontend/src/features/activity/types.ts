// Flat FE types for the activity (audit log) domain, mapped from gen/activity_pb.

export type ActivityEntity =
  | "task"
  | "module"
  | "membership"
  | "ownership"
  | "page"
  | "media"
  | "other";

export type ActivityAction = "created" | "updated" | "deleted" | "other";

export interface FieldChange {
  field: string;
  from?: string;
  to?: string;
}

export interface Activity {
  id: string;
  projectId: string;
  actorId: string;
  entity: ActivityEntity;
  entityId: string;
  action: ActivityAction;
  summary: string;
  changes: FieldChange[];
  createdAt: string;
}
