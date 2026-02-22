import { Component, BaseComponent, CompData } from "bunsane/core/components";

@Component
export class ProjectTag extends BaseComponent { }

@Component
export class ProjectCoreRefComponent extends BaseComponent {
  @CompData({ indexed: true })
  value: string = "";
}

@Component
export class ProjectStatusComponent extends BaseComponent {
  @CompData()
  value: string = "prospect"
}

@Component
export class ProjectDescriptionComponent extends BaseComponent {
  @CompData()
  value: string = ""
}

@Component
export class ProjectPicIdComponent extends BaseComponent {
  @CompData()
  value: string = "";
}

@Component
export class ProjectParentRefComponent extends BaseComponent {
  @CompData({ indexed: true })
  parentProjectId: string = "";
}

@Component
export class ProjectNameComponent extends BaseComponent {
  @CompData()
  value: string = "";
}

