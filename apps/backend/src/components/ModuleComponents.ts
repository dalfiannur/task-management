import { Component, BaseComponent, CompData } from "bunsane/core/components";

@Component
export class ModuleTag extends BaseComponent { }

@Component
export class ModuleNameComponent extends BaseComponent {
  @CompData({ indexed: true })
  value: string = "";
}

@Component
export class ModuleDescriptionComponent extends BaseComponent {
  @CompData()
  value: string = "";
}

@Component
export class ModuleProjectRefComponent extends BaseComponent {
  @CompData({ indexed: true })
  projectId: string = "";
}

@Component
export class ModulePicIdComponent extends BaseComponent {
  @CompData()
  value: string = "";
}
