import { Component, CompData, BaseComponent } from "bunsane/core/components";

@Component
export class ProjectMembershipTag extends BaseComponent {}

@Component
export class ProjectMembershipData extends BaseComponent {
  @CompData({ indexed: true })
  projectId: string = "";

  @CompData({ indexed: true })
  userId: string = "";
}
