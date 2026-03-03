import { Component, BaseComponent, CompData } from "bunsane/core/components";

@Component
export class CommentInfo extends BaseComponent {
  @CompData({ indexed: true })
  taskId: string = "";

  @CompData({ indexed: true })
  authorId: string = "";

  @CompData()
  authorName: string = "";

  @CompData()
  content: string = "";

  @CompData({ indexed: true })
  createdAt: string = "";

  @CompData()
  updatedAt: string = "";

  @CompData()
  mentionedUserIds: string = "[]";
}
