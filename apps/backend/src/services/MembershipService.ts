import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import { t } from "bunsane/gql/schema";
import { Query } from "bunsane/query";
import { ProjectMembershipData } from "~/components/ProjectMembership";
import { ProjectMembershipArcheTypeClass } from "~/archetypes/ProjectMembershipArcheType";
import { requirePermission, type AuthContext } from "~/utils/auth";
import { TaskResources, Action } from "@qyubit/sedjiwa-permissions";

const membershipArcheType = new ProjectMembershipArcheTypeClass();

export default class MembershipService extends BaseService {
  private static instance: MembershipService;

  constructor() {
    super();
    membershipArcheType.registerFieldResolvers(this);
    MembershipService.instance = this;
  }

  static getInstance(): MembershipService {
    return MembershipService.instance;
  }

  /**
   * Internal helper — idempotently ensures a user is a member of a project.
   */
  async ensureMembership(projectId: string, userId: string) {
    const existing = await new Query()
      .with(ProjectMembershipData, {
        filters: [
          Query.typedFilter(ProjectMembershipData, "projectId", "=", projectId),
          Query.typedFilter(ProjectMembershipData, "userId", "=", userId),
        ],
      })
      .exec();
    if (existing.length > 0) return;

    const archetype = new ProjectMembershipArcheTypeClass();
    archetype.fill({
      membership: { projectId, userId },
    });
    await archetype.createAndSaveEntity();
  }

  @GraphQLOperation({
    type: "Query",
    input: { projectId: t.string().required() },
    output: [membershipArcheType],
  })
  async listProjectMembers(input: { projectId: string }, context: AuthContext) {
    requirePermission(context, TaskResources.Projects, Action.Read);
    const entities = await new Query()
      .with(ProjectMembershipData, {
        filters: [
          Query.typedFilter(ProjectMembershipData, "projectId", "=", input.projectId),
        ],
      })
      .populate()
      .exec();
    // Components already cached after populate - use getInMemory
    return entities.map((e: any) => {
      const data = e.getInMemory(ProjectMembershipData);
      return { id: e.id, membership: data };
    });
  }

  @GraphQLOperation({
    type: "Mutation",
    input: { projectId: t.string().required(), userId: t.string().required() },
    output: "Boolean",
  })
  async addProjectMember(
    input: { projectId: string; userId: string },
    context: AuthContext,
  ) {
    requirePermission(context, TaskResources.Projects, Action.Update);
    await this.ensureMembership(input.projectId, input.userId);
    return true;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: { projectId: t.string().required(), userId: t.string().required() },
    output: "Boolean",
  })
  async removeProjectMember(
    input: { projectId: string; userId: string },
    context: AuthContext,
  ) {
    requirePermission(context, TaskResources.Projects, Action.Update);

    const entities = await new Query()
      .with(ProjectMembershipData, {
        filters: [
          Query.typedFilter(ProjectMembershipData, "projectId", "=", input.projectId),
          Query.typedFilter(ProjectMembershipData, "userId", "=", input.userId),
        ],
      })
      .exec();

    for (const entity of entities) {
      await entity.delete();
    }

    return true;
  }

}
