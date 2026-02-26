import { Component, CompData, BaseComponent } from "bunsane/core/components";

@Component
export class TaskInfo extends BaseComponent {
  @CompData({ indexed: true })
  title: string = "";

  @CompData()
  description: string = "";

  @CompData({ indexed: true })
  status: string = "todo";

  @CompData({ indexed: true })
  priority: string = "none";

  @CompData()
  startDate: string = "";

  @CompData()
  dueDate: string = "";

  @CompData()
  order: number = 0;

  @CompData()
  createdAt: string = "";

  @CompData()
  updatedAt: string = "";

  @CompData()
  completedAt: string = "";
}
