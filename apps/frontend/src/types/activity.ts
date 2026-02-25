export interface FieldChange {
  field: string;
  from: string;
  to: string;
}

export interface Activity {
  id: string;
  activityInfo: {
    taskId: string;
    actorId: string;
    actorName: string;
    action: "created" | "updated" | "deleted";
    taskTitle: string;
    changes: string; // JSON string of FieldChange[]
    createdAt: string;
  };
}
