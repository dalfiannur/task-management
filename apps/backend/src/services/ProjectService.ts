import { BaseService } from "bunsane/service";
import { GraphQLOperation } from 'bunsane/gql';
import { t } from 'bunsane/gql/schema';
import { Entity } from 'bunsane/core/Entity';
import { Query } from 'bunsane/query';
import { GraphQLError } from "graphql";
import { ProjectArcheType } from "../archetypes/ProjectArcheType";
import {
  ProjectCoreRefComponent,
  ProjectParentRefComponent,
  ProjectModuleRefComponent,
  ProjectLeaderIdComponent,
  ProjectTag,
} from "~/components/ProjectComponents";
import {
  ModuleDescriptionComponent,
  ModuleNameComponent,
  ModuleOrderComponent,
  ModuleProjectRefComponent,
  ModuleTag,
} from "~/components/ModuleComponents";
import { ProjectMembershipData } from "~/components/ProjectMembership";
import { requireAuth, checkPermission, Resources, type TaskAuthUser } from "~/lib/auth-context";
import MembershipService from "./MembershipService";
import {
  fetchCoreProject,
  createCoreProject,
  extractAuthToken,
} from "~/lib/core-client";

type AuthUser = TaskAuthUser;

export default class ProjectService extends BaseService {
  constructor() {
    super();
    ProjectArcheType.registerFieldResolvers(this);
  }

  /** Find a local project entity by local ID or Core Portal ID (coreRef). */
  private async findProjectEntity(id: string) {
    const entity = await Entity.FindById(id);
    if (entity) return entity;
    const results = await new Query()
      .with(ProjectTag)
      .with(ProjectCoreRefComponent)
      .populate({
        filters: [
          Query.filter("value", Query.filterOp.EQ, id),
        ],
      })
      .exec();
    return results[0] ?? null;
  }

  @GraphQLOperation({
    type: "Query",
    output: [ProjectArcheType],
  })
  async listProjects(_input: unknown, context: { user?: AuthUser; request?: Request }) {
    const allProjects = await new Query()
      .with(ProjectTag)
      .with(ProjectCoreRefComponent)
      .populate()
      .exec();

    // Exclude sub-projects (those with a parent reference)
    const rootProjects: typeof allProjects = [];
    for (const p of allProjects) {
      const parentRef = await p.get(ProjectParentRefComponent);
      if (!parentRef?.parentProjectId) {
        rootProjects.push(p);
      }
    }

    const user = this.extractUser(context);
    let filteredProjects = rootProjects;
    if (user) {
      const canManage = checkPermission({ user }, Resources.Projects, "manage");
      if (!canManage) {
        const memberProjectIds = await this.getMemberProjectIds(user.id);
        filteredProjects = rootProjects.filter((p: any) => memberProjectIds.has(p.id));
      }
    }

    return filteredProjects;
  }

  @GraphQLOperation({
    type: "Query",
    input: {
      id: t.string().required(),
    },
    output: ProjectArcheType,
  })
  async getProject(input: { id: string }, context: { user?: AuthUser; request?: Request }) {
    const entity = await this.findProjectEntity(input.id);
    if (!entity) {
      return new GraphQLError("Project not found", { extensions: { code: "NOT_FOUND" } });
    }

    const user = this.extractUser(context);
    if (user) {
      const canManage = checkPermission({ user }, Resources.Projects, "manage");
      if (!canManage) {
        const memberProjectIds = await this.getMemberProjectIds(user.id);
        if (!memberProjectIds.has(entity.id)) {
          const parentRef = await entity.get(ProjectParentRefComponent);
          if (!parentRef?.parentProjectId || !memberProjectIds.has(parentRef.parentProjectId)) {
            return new GraphQLError("Access denied", { extensions: { code: "FORBIDDEN" } });
          }
        }
      }
    }

    return entity;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      name: t.string().required(),
      clientId: t.string().required(),
      description: t.string(),
      projectLeaderId: t.string(),
      ownerId: t.string(),
      divisionId: t.string(),
      commercial: t.boolean(),
      value: t.float(),
      startDate: t.string(),
      endDate: t.string(),
    },
    output: ProjectArcheType,
  })
  async createProject(
    input: {
      name: string;
      clientId: string;
      description?: string;
      projectLeaderId?: string;
      ownerId?: string;
      divisionId?: string;
      commercial?: boolean;
      value?: number;
      startDate?: string;
      endDate?: string;
    },
    context: { user?: AuthUser; request?: Request },
  ) {
    const user = this.extractUser(context);
    if (!user) {
      return new GraphQLError("Authentication required", { extensions: { code: "UNAUTHENTICATED" } });
    }

    const authToken = extractAuthToken(context.request);

    // Create project in Core (no parentId for root projects)
    const coreProject = await createCoreProject(
      {
        name: input.name,
        description: input.description,
        clientId: input.clientId,
        authorId: user.id,
        ownerId: input.ownerId,
        divisionId: input.divisionId,
        commercial: input.commercial,
        value: input.value,
        projectLeaderId: input.projectLeaderId,
        startDate: input.startDate,
        endDate: input.endDate,
      },
      authToken,
    );

    // Create local entity
    const entity = Entity.Create()
      .add(ProjectTag, {})
      .add(ProjectCoreRefComponent, { value: coreProject.id })

    if (input.projectLeaderId) {
      entity.add(ProjectLeaderIdComponent, { value: input.projectLeaderId });
    }

    await entity.save();

    // Auto-add creator and leader as members
    await MembershipService.getInstance().ensureMembership(entity.id, user.id);
    if (input.projectLeaderId) {
      await MembershipService.getInstance().ensureMembership(entity.id, input.projectLeaderId);
    }

    return entity;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      parentProjectId: t.string().required(),
      name: t.string().required(),
      description: t.string(),
      projectLeaderId: t.string(),
      ownerId: t.string(),
      divisionId: t.string(),
      commercial: t.boolean(),
      value: t.float(),
      startDate: t.string(),
      endDate: t.string(),
      moduleId: t.string(),
    },
    output: ProjectArcheType,
  })
  async createSubProject(
    input: {
      parentProjectId: string;
      name: string;
      description?: string;
      projectLeaderId?: string;
      ownerId?: string;
      divisionId?: string;
      commercial?: boolean;
      value?: number;
      startDate?: string;
      endDate?: string;
      moduleId?: string;
    },
    context: { user?: AuthUser; request?: Request },
  ) {
    // 1. Find parent project and get its coreRef
    const parent = await new Query().findOneById(input.parentProjectId);
    if (!parent) {
      return new GraphQLError("Parent project not found", { extensions: { code: "NOT_FOUND" } });
    }

    const parentCoreRef = await parent.get(ProjectCoreRefComponent);
    if (!parentCoreRef?.value) {
      return new GraphQLError("Parent project has no Core reference", { extensions: { code: "BAD_USER_INPUT" } });
    }

    // 2. Fetch parent Core data to inherit clientId
    const authToken = extractAuthToken(context.request);
    const parentCoreData = await fetchCoreProject(parentCoreRef.value, authToken);
    if (!parentCoreData) {
      return new GraphQLError("Could not fetch parent project data from Core", { extensions: { code: "INTERNAL_ERROR" } });
    }

    const clientId = parentCoreData.ref.clientId;
    if (!clientId) {
      return new GraphQLError("Parent project has no clientId in Core", { extensions: { code: "BAD_USER_INPUT" } });
    }

    // 3. Extract user for authorId
    const user = this.extractUser(context);
    if (!user) {
      return new GraphQLError("Authentication required", { extensions: { code: "UNAUTHENTICATED" } });
    }

    // 4. Create project in Core with parentId
    const coreProject = await createCoreProject(
      {
        name: input.name,
        description: input.description,
        clientId,
        authorId: user.id,
        parentId: parentCoreRef.value,
        ownerId: input.ownerId,
        divisionId: input.divisionId,
        commercial: input.commercial,
        value: input.value,
        projectLeaderId: input.projectLeaderId,
        startDate: input.startDate,
        endDate: input.endDate,
      },
      authToken,
    );

    // 5. Validate moduleId belongs to parent project if provided
    if (input.moduleId) {
      const moduleEntity = await new Query().findOneById(input.moduleId);
      if (!moduleEntity) {
        return new GraphQLError("Module not found", { extensions: { code: "NOT_FOUND" } });
      }
      const moduleProjectRef = await moduleEntity.get(ModuleProjectRefComponent);
      if (moduleProjectRef?.projectId !== input.parentProjectId) {
        return new GraphQLError("Module does not belong to the parent project", { extensions: { code: "BAD_USER_INPUT" } });
      }
    }

    // 6. Create local entity with coreRef pointing to new Core project
    const entity = Entity.Create()
      .add(ProjectTag, {})
      .add(ProjectParentRefComponent, { parentProjectId: input.parentProjectId })
      .add(ProjectCoreRefComponent, { value: coreProject.id })

    if (input.projectLeaderId) {
      entity.add(ProjectLeaderIdComponent, { value: input.projectLeaderId });
    }

    if (input.moduleId) {
      entity.add(ProjectModuleRefComponent, { moduleId: input.moduleId });
    }

    await entity.save();

    // 6. Auto-add creator and leader as members
    await MembershipService.getInstance().ensureMembership(entity.id, user.id);
    if (input.projectLeaderId) {
      await MembershipService.getInstance().ensureMembership(entity.id, input.projectLeaderId);
    }

    return entity;
  }

  @GraphQLOperation({
    type: "Query",
    input: { parentProjectId: t.string().required() },
    output: [ProjectArcheType],
  })
  async listSubProjects(
    input: { parentProjectId: string },
    context: { user?: AuthUser; request?: Request },
  ) {
    const allSubProjects = await new Query()
      .with(ProjectTag)
      .with(ProjectCoreRefComponent)
      .with(ProjectParentRefComponent, {
        filters: [
          Query.typedFilter(ProjectParentRefComponent, "parentProjectId", "=", input.parentProjectId),
        ],
      })
      .populate()
      .exec();

    const user = this.extractUser(context);
    let filteredProjects = allSubProjects;
    if (user) {
      const canManage = checkPermission({ user }, Resources.Projects, "manage");
      if (!canManage) {
        const memberProjectIds = await this.getMemberProjectIds(user.id);
        if (!memberProjectIds.has(input.parentProjectId)) {
          filteredProjects = allSubProjects.filter((p: any) => memberProjectIds.has(p.id));
        }
      }
    }

    return filteredProjects;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      id: t.string().required(),
      name: t.string(),
      description: t.string(),
      status: t.string(),
      projectLeaderId: t.string(),
      moduleId: t.string(),
    },
    output: ProjectArcheType,
  })
  async updateProject(input: {
    id: string;
    name?: string;
    description?: string;
    status?: string;
    projectLeaderId?: string;
    moduleId?: string | null;
  }, context: { user?: AuthUser; request?: Request }) {
    const entity = await this.findProjectEntity(input.id);
    if (!entity) {
      return new GraphQLError("Project not found", { extensions: { code: "NOT_FOUND" } });
    }

    if (input.projectLeaderId) {
      await entity.set(ProjectLeaderIdComponent, { value: input.projectLeaderId });
      // Auto-add leader as member
      await MembershipService.getInstance().ensureMembership(input.id, input.projectLeaderId);
    }

    // Handle moduleId: string → set, null → remove, undefined → no change
    if (input.moduleId !== undefined) {
      if (input.moduleId === null) {
        entity.remove(ProjectModuleRefComponent);
      } else {
        // Validate module belongs to the sub-project's parent project
        const parentRef = await entity.get(ProjectParentRefComponent);
        if (parentRef?.parentProjectId) {
          const moduleEntity = await new Query().findOneById(input.moduleId);
          if (!moduleEntity) {
            return new GraphQLError("Module not found", { extensions: { code: "NOT_FOUND" } });
          }
          const moduleProjectRef = await moduleEntity.get(ModuleProjectRefComponent);
          if (moduleProjectRef?.projectId !== parentRef.parentProjectId) {
            return new GraphQLError("Module does not belong to the parent project", { extensions: { code: "BAD_USER_INPUT" } });
          }
        }
        await entity.set(ProjectModuleRefComponent, { moduleId: input.moduleId });
      }
    }

    await entity.save();

    return entity;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      id: t.string().required(),
      description: t.string(),
    },
    output: ProjectArcheType,
  })
  async approveProject(
    args: { id: string; description?: string },
    context: { user?: AuthUser; request?: Request },
  ) {
    // Requires project manage permission
    const user = requireAuth(context);
    if (!checkPermission({ user }, Resources.Projects, "manage")) {
      throw new Error("Permission denied: project manage required");
    }

    const project = Entity.Create()
      .add(ProjectTag, {})
      .add(ProjectCoreRefComponent, { value: args.id })

    await project.save();

    const module = Entity.Create()
      .add(ModuleTag, {})
      .add(ModuleProjectRefComponent, { projectId: project.id })
      .add(ModuleNameComponent, { value: "Proposal" })
      .add(ModuleDescriptionComponent, { value: "" })
      .add(ModuleOrderComponent, { value: 0 });

    await module.save();

    // Auto-add approver and leader as members
    await MembershipService.getInstance().ensureMembership(project.id, user.id);

    return project;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      id: t.string().required(),
    },
    output: "Boolean",
  })
  async deleteProject(input: { id: string }) {
    const entity = await this.findProjectEntity(input.id);
    if (!entity) {
      return new GraphQLError("Project not found", { extensions: { code: "NOT_FOUND" } });
    }

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

  /** Extract authenticated user from context (nullable, non-throwing). */
  private extractUser(context: { user?: AuthUser }) {
    return context.user ?? null;
  }

  /** Get set of project IDs the user is a member of. */
  private async getMemberProjectIds(userId: string): Promise<Set<string>> {
    const memberships = await new Query()
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
