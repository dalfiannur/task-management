import { ArcheType, ArcheTypeField, BaseArcheType, BelongsTo, type ArcheTypeOwnProperties } from "bunsane/core/ArcheType";
import {
  ProjectCoreRefComponent,
  ProjectParentRefComponent,
  ProjectModuleRefComponent,
  ProjectLeaderIdComponent,
} from "~/components/ProjectComponents";
import { type IModuleArcheType } from "./ModuleArcheType";
import { ArcheTypeNames } from "./ArcheTypeNames";

@ArcheType(ArcheTypeNames.Project)
export class ProjectArcheTypeClass extends BaseArcheType {
  @ArcheTypeField(ProjectCoreRefComponent, { nullable: true })
  coreRef!: ProjectCoreRefComponent;

  @ArcheTypeField(ProjectLeaderIdComponent, { nullable: true })
  projectLeaderId!: ProjectLeaderIdComponent;

  @ArcheTypeField(ProjectParentRefComponent, { nullable: true })
  parentRef!: ProjectParentRefComponent;

  @ArcheTypeField(ProjectModuleRefComponent, { nullable: true })
  moduleRef!: ProjectModuleRefComponent;

  @BelongsTo("Project", { foreignKey: "parentRef.parentProjectId", nullable: true })
  parent!: IProjectArcheType;

  @BelongsTo("Module", { foreignKey: "moduleRef.moduleId", nullable: true })
  linkedModule!: IModuleArcheType;
}

export const ProjectArcheType = new ProjectArcheTypeClass();
export type IProjectArcheType = ArcheTypeOwnProperties<ProjectArcheTypeClass>;
