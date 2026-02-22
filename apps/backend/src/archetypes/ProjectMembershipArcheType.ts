import { ArcheType, ArcheTypeField, BaseArcheType } from "bunsane/core/ArcheType";
import { ProjectMembershipData } from "~/components/ProjectMembership";
import { ArcheTypeNames } from "./ArcheTypeNames";

@ArcheType(ArcheTypeNames.ProjectMembership)
export class ProjectMembershipArcheTypeClass extends BaseArcheType {
  @ArcheTypeField(ProjectMembershipData)
  membership!: ProjectMembershipData;
}

export const ProjectMembershipArcheType = new ProjectMembershipArcheTypeClass();
