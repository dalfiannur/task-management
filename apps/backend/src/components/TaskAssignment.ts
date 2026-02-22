import { Component, BaseComponent, CompData } from "bunsane/core/components";

@Component
export class TaskAssignment extends BaseComponent {
  /** JSON-encoded array of assignee IDs (e.g. '["id1","id2"]') */
  @CompData()
  assigneeIds: string = "[]";

  @CompData({ indexed: true })
  moduleId: string = "";

  getAssigneeIdArray(): string[] {
    try {
      return JSON.parse(this.assigneeIds);
    } catch {
      return [];
    }
  }

  static encodeAssigneeIds(ids: string[]): string {
    return JSON.stringify(ids);
  }
}
