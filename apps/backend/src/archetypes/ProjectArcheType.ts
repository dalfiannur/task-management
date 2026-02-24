import { ArcheType, ArcheTypeField, BaseArcheType, BelongsTo, type ArcheTypeOwnProperties } from "bunsane/core/ArcheType";
import {
  ProjectCoreRefComponent,
  ProjectDescriptionComponent,
  ProjectNameComponent,
  ProjectParentRefComponent,
  ProjectLeaderIdComponent,
  ProjectStatusComponent,
  ProjectCodeComponent,
  ProjectCoreNameComponent,
  ProjectCoreDescriptionComponent,
  ProjectClientNameComponent,
  ProjectClientLegalNameComponent,
  ProjectWinStageComponent,
  ProjectResolvedStatusComponent,
} from "~/components/ProjectComponents";
import { ArcheTypeNames } from "./ArcheTypeNames";

@ArcheType(ArcheTypeNames.Project)
export class ProjectArcheTypeClass extends BaseArcheType {
  @ArcheTypeField(ProjectCoreRefComponent, { nullable: true })
  coreRef!: ProjectCoreRefComponent;

  @ArcheTypeField(ProjectDescriptionComponent, { nullable: true })
  description!: ProjectDescriptionComponent

  @ArcheTypeField(ProjectStatusComponent, { nullable: true })
  status!: ProjectStatusComponent

  @ArcheTypeField(ProjectLeaderIdComponent, { nullable: true })
  projectLeaderId!: ProjectLeaderIdComponent;

  @ArcheTypeField(ProjectNameComponent, { nullable: true })
  name!: ProjectNameComponent;

  @BelongsTo("Project", { foreignKey: "parent.parentProjectId", nullable: true })
  parent!: IProjectArcheType;

  // Enrichment fields — populated from Core API at query time

  @ArcheTypeField(ProjectCodeComponent, { nullable: true })
  code!: ProjectCodeComponent;

  @ArcheTypeField(ProjectCoreNameComponent, { nullable: true })
  coreName!: ProjectCoreNameComponent;

  @ArcheTypeField(ProjectCoreDescriptionComponent, { nullable: true })
  coreDescription!: ProjectCoreDescriptionComponent;

  @ArcheTypeField(ProjectClientNameComponent, { nullable: true })
  clientName!: ProjectClientNameComponent;

  @ArcheTypeField(ProjectClientLegalNameComponent, { nullable: true })
  clientLegalName!: ProjectClientLegalNameComponent;

  @ArcheTypeField(ProjectWinStageComponent, { nullable: true })
  winStage!: ProjectWinStageComponent;

  @ArcheTypeField(ProjectResolvedStatusComponent, { nullable: true })
  resolvedStatus!: ProjectResolvedStatusComponent;
}

export const ProjectArcheType = new ProjectArcheTypeClass();
export type IProjectArcheType = ArcheTypeOwnProperties<ProjectArcheTypeClass>;
