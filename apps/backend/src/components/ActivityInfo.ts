import { Component, BaseComponent, CompData } from "bunsane/core/components";

@Component
export class ActivityInfo extends BaseComponent {
  @CompData({ indexed: true })
  taskId: string = "";

  @CompData({ indexed: true })
  actorId: string = "";

  @CompData()
  actorName: string = "";

  @CompData({ indexed: true })
  action: string = "";

  @CompData()
  changes: string = "[]";

  @CompData()
  createdAt: string = "";
}
