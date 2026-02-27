import { Component, BaseComponent, CompData } from "bunsane/core/components";

@Component
export class PageInfo extends BaseComponent {
  @CompData({ indexed: true })
  projectId: string = "";

  @CompData()
  title: string = "";

  @CompData()
  icon: string = "";

  @CompData()
  content: string = "";

  @CompData()
  order: number = 0;

  @CompData({ indexed: true })
  createdById: string = "";

  @CompData()
  createdByName: string = "";

  @CompData()
  lastEditedById: string = "";

  @CompData()
  lastEditedByName: string = "";

  @CompData()
  createdAt: string = "";

  @CompData()
  updatedAt: string = "";

  @CompData({ indexed: true })
  linkedTaskId: string = "";

  @CompData({ indexed: true })
  linkedModuleId: string = "";
}
