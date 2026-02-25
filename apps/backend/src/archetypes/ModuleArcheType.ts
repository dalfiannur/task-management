import {
  ArcheTypeField,
  ArcheType,
  BaseArcheType,
  BelongsTo,
  type ArcheTypeOwnProperties,
} from "bunsane/core/ArcheType";
import {
  ModuleDescriptionComponent,
  ModuleNameComponent,
  ModulePicIdComponent,
} from "../components/ModuleComponents";
import { type IProjectArcheType } from "./ProjectArcheType";
import { ArcheTypeNames } from "./ArcheTypeNames";

@ArcheType(ArcheTypeNames.Module)
export class ModuleArcheTypeClass extends BaseArcheType {
  @ArcheTypeField(ModuleNameComponent, { nullable: true })
  name!: string;

  @ArcheTypeField(ModuleDescriptionComponent, { nullable: true })
  description!: string;

  @ArcheTypeField(ModulePicIdComponent, { nullable: true })
  picId!: ModulePicIdComponent;

  @BelongsTo("Project", { foreignKey: "project.projectId", nullable: true })
  project!: IProjectArcheType;
}

export type IModuleArcheType = ArcheTypeOwnProperties<ModuleArcheTypeClass>;
export const ModuleArcheType = new ModuleArcheTypeClass();
