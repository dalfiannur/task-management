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
  @CompData({ indexed: true })
  value: string = "prospect"
}

@Component
export class ProjectDescriptionComponent extends BaseComponent {
  @CompData()
  value: string = ""
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

@Component
export class ProjectNameComponent extends BaseComponent {
  @CompData()
  value: string = "";
}

// Virtual enrichment components — populated at query time from Core API, never saved to DB

@Component
export class ProjectCodeComponent extends BaseComponent {
  @CompData()
  value: string = "";
}

@Component
export class ProjectCoreNameComponent extends BaseComponent {
  @CompData()
  value: string = "";
}

@Component
export class ProjectCoreDescriptionComponent extends BaseComponent {
  @CompData()
  value: string = "";
}

@Component
export class ProjectClientNameComponent extends BaseComponent {
  @CompData()
  value: string = "";
}

@Component
export class ProjectClientLegalNameComponent extends BaseComponent {
  @CompData()
  value: string = "";
}

@Component
export class ProjectWinStageComponent extends BaseComponent {
  @CompData()
  value: string = "";
}

@Component
export class ProjectResolvedStatusComponent extends BaseComponent {
  @CompData()
  value: string = "";
}

@Component
export class ProjectClosedAtComponent extends BaseComponent {
  @CompData()
  value: string = "";
}

