import { BaseService } from "bunsane/service";
import { GraphQLOperation } from 'bunsane/gql';
import { Entity } from 'bunsane/core/Entity';
import { Query } from 'bunsane/query';
import { z } from "zod";
import { ProjectArcheType } from "../archetypes/ProjectArcheType";
import {
  ProjectCoreRefComponent,
  ProjectDescriptionComponent,
  ProjectNameComponent,
  ProjectParentRefComponent,
  ProjectPicIdComponent,
  ProjectStatusComponent,
  ProjectTag,
} from "~/components/ProjectComponents";
import {
  ModuleDescriptionComponent,
  ModuleNameComponent,
  ModuleProjectRefComponent,
  ModuleTag,
} from "~/components/ModuleComponents";
import { ProjectMembershipTag, ProjectMembershipData } from "~/components/ProjectMembership";
import { AuthPlugin } from "~/plugins/AuthPlugin";
import { getUserRole, requireManager } from "./UserService";
import MembershipService from "./MembershipService";

export default class ProjectService extends BaseService {
  constructor() {
    super();
    ProjectArcheType.registerFieldResolvers(this);
  }

  @GraphQLOperation({
    type: "Query",
    output: [ProjectArcheType],
  })
  async listProjects(_input: unknown, context: { request?: Request }) {
    const query = new Query()
      .with(ProjectTag)
      .with(ProjectCoreRefComponent)
      .with(ProjectStatusComponent);
    const allProjects = await query.populate().exec();

    const user = await this.extractUser(context);
    if (!user) return allProjects;

    const role = user.role ?? await getUserRole(user.id);
    if (role === "manager") return allProjects;

    // Filter by membership
    const memberProjectIds = await this.getMemberProjectIds(user.id);
    return allProjects.filter((p: any) => memberProjectIds.has(p.id));
  }

  @GraphQLOperation({
    type: "Query",
    input: z.object({
      id: z.string(),
    }),
    output: ProjectArcheType,
  })
  async getProject(input: { id: string }, context: { request?: Request }) {
    const entity = await Entity.FindById(input.id);
    if (!entity) throw new Error("Project not found");

    const user = await this.extractUser(context);
    if (user) {
      const role = user.role ?? await getUserRole(user.id);
      if (role !== "manager") {
        const memberProjectIds = await this.getMemberProjectIds(user.id);
        if (!memberProjectIds.has(input.id)) throw new Error("Access denied");
      }
    }

    return await ProjectArcheType.Unwrap(entity);
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      parentProjectId: z.string(),
      name: z.string(),
      description: z.string().optional(),
      picId: z.string().optional(),
    }),
    output: ProjectArcheType,
  })
  async createSubProject(
    input: {
      parentProjectId: string;
      name: string;
      description?: string;
      picId?: string;
    },
    context: { request?: Request },
  ) {
    const parent = await new Query().findOneById(input.parentProjectId);
    if (!parent) throw new Error("Parent project not found");

    const entity = Entity.Create()
      .add(ProjectTag, {})
      .add(ProjectNameComponent, { value: input.name })
      .add(ProjectParentRefComponent, { parentProjectId: input.parentProjectId })
      .add(ProjectCoreRefComponent, { value: "" })
      .add(ProjectDescriptionComponent, { value: input.description || "" })
      .add(ProjectStatusComponent, { value: "on_going" });

    if (input.picId) {
      entity.add(ProjectPicIdComponent, { value: input.picId });
    }

    await entity.save();

    // Auto-add creator and PIC as members
    const user = await this.extractUser(context);
    if (user) {
      await MembershipService.getInstance().ensureMembership(entity.id, user.id);
    }
    if (input.picId) {
      await MembershipService.getInstance().ensureMembership(entity.id, input.picId);
    }

    return entity;
  }

  @GraphQLOperation({
    type: "Query",
    input: z.object({ parentProjectId: z.string() }),
    output: [ProjectArcheType],
  })
  async listSubProjects(
    input: { parentProjectId: string },
    context: { request?: Request },
  ) {
    const allSubProjects = await new Query()
      .with(ProjectTag)
      .with(ProjectStatusComponent)
      .with(ProjectParentRefComponent, {
        filters: [
          Query.typedFilter(ProjectParentRefComponent, "parentProjectId", "=", input.parentProjectId),
        ],
      })
      .populate()
      .exec();

    const user = await this.extractUser(context);
    if (!user) return allSubProjects;

    const role = user.role ?? await getUserRole(user.id);
    if (role === "manager") return allSubProjects;

    // Filter by membership
    const memberProjectIds = await this.getMemberProjectIds(user.id);
    return allSubProjects.filter((p: any) => memberProjectIds.has(p.id));
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      status: z.string().optional(),
      picId: z.string().optional(),
    }),
    output: ProjectArcheType,
  })
  async updateProject(input: {
    id: string;
    name?: string;
    description?: string;
    status?: string;
    picId?: string;
  }) {
    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Project not found");

    if (input.name) {
      await entity.set(ProjectNameComponent, { value: input.name });
    }

    if (input.status) {
      await entity.set(ProjectStatusComponent, { value: input.status });
    }

    if (input.description) {
      await entity.set(ProjectDescriptionComponent, { value: input.description });
    }

    if (input.picId) {
      await entity.set(ProjectPicIdComponent, { value: input.picId });
      // Auto-add PIC as member
      await MembershipService.getInstance().ensureMembership(input.id, input.picId);
    }

    await entity.save();

    return await ProjectArcheType.Unwrap(entity);
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      id: z.string(),
      description: z.string().optional(),
    }),
    output: ProjectArcheType,
  })
  async approveProject(
    args: { id: string; description?: string },
    context: { request?: Request },
  ) {
    // Manager only
    const user = await requireManager(context);

    const project = Entity.Create()
      .add(ProjectTag, {})
      .add(ProjectCoreRefComponent, { value: args.id, })
      .add(ProjectDescriptionComponent, { value: args.description || "" })
      .add(ProjectStatusComponent, {
        value: "prospect"
      });

    await project.save();

    const module = Entity.Create()
      .add(ModuleTag, {})
      .add(ModuleProjectRefComponent, { projectId: project.id })
      .add(ModuleNameComponent, { value: "Proposal" })
      .add(ModuleDescriptionComponent, { value: "" });

    await module.save();

    // Auto-add approver as member
    await MembershipService.getInstance().ensureMembership(project.id, user.id);

    return project;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      id: z.string(),
    }),
    output: "Boolean",
  })
  async deleteProject(input: { id: string }) {
    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Project not found");

    // Cascade delete sub-projects
    const subProjects = await new Query()
      .with(ProjectTag)
      .with(ProjectParentRefComponent, {
        filters: [
          Query.typedFilter(ProjectParentRefComponent, "parentProjectId", "=", input.id),
        ],
      })
      .populate()
      .exec();

    for (const sub of subProjects) {
      await sub.delete();
    }

    await entity.delete();
    return true;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      id: z.string(),
      status: z.enum(['prospect', 'win', 'on_going'])
    }),
    output: "Boolean",
  })
  async updateProjectStatus(input: { id: string; status: string }) {
    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Project not found");
    await entity.set(ProjectStatusComponent, { value: input.status });
    await entity.save();
    return true;
  }

  /** Extract authenticated user from request (nullable, non-throwing). */
  private async extractUser(context: { request?: Request }) {
    if (!context.request) return null;
    return await AuthPlugin.extractUser(context.request);
  }

  /** Get set of project IDs the user is a member of. */
  private async getMemberProjectIds(userId: string): Promise<Set<string>> {
    const memberships = await new Query()
      .with(ProjectMembershipTag)
      .with(ProjectMembershipData, {
        filters: [Query.typedFilter(ProjectMembershipData, "userId", "=", userId)],
      })
      .exec();

    const ids = new Set<string>();
    for (const m of memberships) {
      const data = await m.get(ProjectMembershipData);
      if (data?.projectId) ids.add(data.projectId);
    }
    return ids;
  }
}
