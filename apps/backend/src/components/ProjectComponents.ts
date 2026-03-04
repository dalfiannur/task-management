import { Component, BaseComponent, CompData } from "bunsane/core/components";

@Component
export class ProjectTag extends BaseComponent { }

@Component
export class ProjectCoreRefComponent extends BaseComponent {
  @CompData({ indexed: true })
  value: string = "";
}

@Component
export class ProjectLeaderIdComponent extends BaseComponent {
  @CompData()
  value: string = "";
}

@Component
export class ProjectParentRefComponent extends BaseComponent {
  @CompData({ indexed: true })
  parentProjectId: string = "";
}

@Component
export class ProjectModuleRefComponent extends BaseComponent {
  @CompData({ indexed: true })
  moduleId: string = "";
}