import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import { t } from "bunsane/gql/schema";
import { Query } from "bunsane/query";
import { ProjectMembershipData } from "~/components/ProjectMembership";
import { ProjectMembershipArcheTypeClass } from "~/archetypes/ProjectMembershipArcheType";
import { ProjectLeaderIdComponent } from "~/components/ProjectComponents";
import { getUserRole } from "./UserService";

type AuthUser = { id: string; sub: string; email: string; name: string; picture?: string; role?: string };

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
  async listProjectMembers(input: { projectId: string }) {
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
    context: { user?: AuthUser },
  ) {
    await this.requireMember(context, input.projectId);
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
    context: { user?: AuthUser },
  ) {
    await this.requireMember(context, input.projectId);

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

  /**
   * Auth helper: caller must be a manager, project leader, or project member.
   */
  private async requireMember(context: { user?: AuthUser }, projectId: string) {
    if (!context.user) throw new Error("Authentication required");
    const user = context.user;

    const role = user.role ?? await getUserRole(user.id);
    if (role === "manager") return user;

    // Check if user is the project leader
    const projectEntity = await new Query().findOneById(projectId);
    if (projectEntity) {
      const leaderComponent = await projectEntity.get(ProjectLeaderIdComponent);
      if (leaderComponent?.value === user.id) return user;
    }

    // Check if user is a project member
    const memberships = await new Query()
      .with(ProjectMembershipData, {
        filters: [
          Query.typedFilter(ProjectMembershipData, "projectId", "=", projectId),
          Query.typedFilter(ProjectMembershipData, "userId", "=", user.id),
        ],
      })
      .exec();
    if (memberships.length > 0) return user;

    throw new Error("Project membership required");
  }
}
