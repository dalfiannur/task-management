import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import { Query } from "bunsane/query";
import { z } from "zod";
import { ProjectMembershipData } from "~/components/ProjectMembership";
import { ProjectMembershipArcheTypeClass } from "~/archetypes/ProjectMembershipArcheType";
import { ProjectPicIdComponent } from "~/components/ProjectComponents";
import { AuthPlugin } from "~/plugins/AuthPlugin";
import { getUserRole } from "./UserService";

const membershipArcheType = new ProjectMembershipArcheTypeClass();

export default class MembershipService extends BaseService {
  private static instance: MembershipService;

  constructor() {
    super();
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
    input: z.object({ projectId: z.string() }),
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
    return await Promise.all(
      entities.map(async (e: any) => {
        const data = await e.get(ProjectMembershipData);
        return { id: e.id, membership: data };
      }),
    );
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({ projectId: z.string(), userId: z.string() }),
    output: "Boolean",
  })
  async addProjectMember(
    input: { projectId: string; userId: string },
    context: { request?: Request },
  ) {
    await this.requireManagerOrPic(context, input.projectId);
    await this.ensureMembership(input.projectId, input.userId);
    return true;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({ projectId: z.string(), userId: z.string() }),
    output: "Boolean",
  })
  async removeProjectMember(
    input: { projectId: string; userId: string },
    context: { request?: Request },
  ) {
    await this.requireManagerOrPic(context, input.projectId);

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
   * Auth helper: caller must be a manager OR the project's PIC.
   */
  private async requireManagerOrPic(context: { request?: Request }, projectId: string) {
    if (!context.request) throw new Error("Authentication required");
    const user = await AuthPlugin.extractUser(context.request);
    if (!user) throw new Error("Authentication required");

    const role = user.role ?? await getUserRole(user.id);
    if (role === "manager") return user;

    // Check if user is the project PIC
    const projectEntity = await new Query().findOneById(projectId);
    if (projectEntity) {
      const picComponent = await projectEntity.get(ProjectPicIdComponent);
      if (picComponent?.value === user.id) return user;
    }

    throw new Error("Manager or PIC access required");
  }
}
