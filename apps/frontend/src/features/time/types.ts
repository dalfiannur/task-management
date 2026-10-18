// Flat FE types for time tracking, mapped from gen/time_pb.

export interface TimeEntry {
  id: string;
  taskId: string;
  projectId: string;
  userId: string;
  /** yyyy-MM-dd — the day the minutes count for. */
  date: string;
  startedAt?: string;
  endedAt?: string;
  /** 0 while running. */
  minutes: number;
  note: string;
  running: boolean;
  taskTitle: string;
  taskNumber: number;
}
