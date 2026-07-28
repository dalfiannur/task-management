import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import { t } from "bunsane/gql/schema";
import { Query } from "bunsane/query";
import { ProjectMembershipData } from "~/components/ProjectMembership";
import { ProjectMembershipArcheTypeClass } from "~/archetypes/ProjectMembershipArcheType";
import { ProjectLeaderIdComponent } from "~/components/ProjectComponents";
import { resolveLocalProjectId } from "~/lib/resolve-project-id";
import { requirePermission, requireUser, type AuthContext, TasksResources, CoreResources, Action } from "~/utils/auth";
import { hasPermission } from "~/auth";
import { GraphQLError } from "graphql";

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
    requirePermission(context, CoreResources.Projects, Action.Read);
    const localProjectId = await resolveLocalProjectId(input.projectId);
    const entities = await new Query()
      .with(ProjectMembershipData, {
        filters: [
          Query.typedFilter(ProjectMembershipData, "projectId", "=", localProjectId),
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
    requirePermission(context, CoreResources.Projects, Action.Update);
    const localProjectId = await resolveLocalProjectId(input.projectId);
    await this.ensureMembership(localProjectId, input.userId);
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
    const user = requireUser(context);
    const localProjectId = await resolveLocalProjectId(input.projectId);

    // Allow if admin, project leader, or has DeleteAll on projects
    const isAdmin = user.permissions?.includes("*") ?? false;
    const hasDeleteAll = hasPermission(user.permissions ?? [], CoreResources.Projects, Action.DeleteAll);

    if (!isAdmin && !hasDeleteAll) {
      // Check if user is the project leader
      const projectEntity = await new Query().findOneById(localProjectId);
      const leaderComp = projectEntity ? await projectEntity.get(ProjectLeaderIdComponent) : null;
      const isLeader = leaderComp?.value === user.sub;

      if (!isLeader) {
        throw new GraphQLError("Only the project leader or admins can remove members", {
          extensions: { code: "FORBIDDEN" },
        });
      }
    }

    const entities = await new Query()
      .with(ProjectMembershipData, {
        filters: [
          Query.typedFilter(ProjectMembershipData, "projectId", "=", localProjectId),
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
