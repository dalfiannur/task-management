import { ArcheType, ArcheTypeField, BaseArcheType, BelongsTo, type ArcheTypeOwnProperties } from "bunsane/core/ArcheType";
import { ProjectCoreRefComponent, ProjectDescriptionComponent, ProjectNameComponent, ProjectParentRefComponent, ProjectPicIdComponent, ProjectStatusComponent } from "~/components/ProjectComponents";
import { ArcheTypeNames } from "./ArcheTypeNames";

@ArcheType(ArcheTypeNames.Project)
export class ProjectArcheTypeClass extends BaseArcheType {
  @ArcheTypeField(ProjectCoreRefComponent, { nullable: true })
  coreRef!: ProjectCoreRefComponent;

  @ArcheTypeField(ProjectDescriptionComponent, { nullable: true })
  description!: ProjectDescriptionComponent

  @ArcheTypeField(ProjectStatusComponent, { nullable: true })
  status!: ProjectStatusComponent

  @ArcheTypeField(ProjectPicIdComponent, { nullable: true })
  picId!: ProjectPicIdComponent;

  @ArcheTypeField(ProjectNameComponent, { nullable: true })
  name!: ProjectNameComponent;

  @BelongsTo("Project", { foreignKey: "parent.parentProjectId", nullable: true })
  parent!: IProjectArcheType;
}

export const ProjectArcheType = new ProjectArcheTypeClass();
export type IProjectArcheType = ArcheTypeOwnProperties<ProjectArcheTypeClass>;
