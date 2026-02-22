import { Component, BaseComponent, CompData } from "bunsane/core/components";

@Component
export class NotificationInfo extends BaseComponent {
  @CompData({ indexed: true })
  recipientId: string = "";

  @CompData({ indexed: true })
  type: string = "";

  @CompData()
  actorId: string = "";

  @CompData()
  actorName: string = "";

  @CompData()
  taskId: string = "";

  @CompData()
  taskTitle: string = "";

  @CompData()
  commentId: string = "";

  @CompData()
  message: string = "";

  @CompData({ indexed: true })
  read: string = "false";

  @CompData()
  createdAt: string = "";
}
