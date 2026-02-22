import { Component, CompData, BaseComponent } from "bunsane/core/components";

@Component
export class TaskLabels extends BaseComponent {
  /** JSON-encoded array of label IDs (e.g. '["id1","id2"]') */
  @CompData()
  labelIds: string = "[]";

  getLabelIdArray(): string[] {
    try {
      return JSON.parse(this.labelIds);
    } catch {
      return [];
    }
  }

  static encodeLabelIds(ids: string[]): string {
    return JSON.stringify(ids);
  }
}
