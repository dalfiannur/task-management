import { Component, BaseComponent, CompData } from "bunsane/core/components";

@Component
export class TaskMediaLinkTag extends BaseComponent {}

@Component
export class TaskMediaLinkData extends BaseComponent {
  @CompData({ indexed: true })
  mediaFileId: string = "";

  @CompData({ indexed: true })
  taskId: string = "";

  @CompData({ indexed: true })
  projectId: string = "";
}
