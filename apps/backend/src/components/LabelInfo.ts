import { Component, BaseComponent, CompData } from "bunsane/core/components";

@Component
export class LabelInfo extends BaseComponent {
  @CompData({ indexed: true })
  name: string = "";

  @CompData()
  color: string = "#000000";

  @CompData({ indexed: true })
  projectId: string = "";
}
