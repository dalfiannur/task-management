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
import { resolveLocalProjectId } from "~/lib/resolve-project-id";
import {
  ModuleDescriptionComponent,
  ModuleNameComponent,
  ModuleOrderComponent,
  ModuleProjectRefComponent,
  ModuleTag,
} from "~/components/ModuleComponents";
import { ProjectMembershipData } from "~/components/ProjectMembership";
import { requirePermission, requireAdmin, checkProjectMember, type AuthContext, TasksResources, CoreResources, Action } from "~/utils/auth";
import MembershipService from "./MembershipService";
import {
  fetchCoreProject,
  createCoreProject,
  deleteCoreProject,
  extractAuthToken,
  fetchUserCompanyIds,
} from "~/lib/core-client";
import { fetchUserIdsByPermission } from "~/lib/oidc-client";

export default class ProjectService extends BaseService {
  constructor() {
    super();
    ProjectArcheType.registerFieldResolvers(this);
  }

  /** Find a local project entity by local ID or Core Portal ID (coreRef). */
  private async findProjectEntity(id: string) {
    const localId = await resolveLocalProjectId(id);
    return await Entity.FindById(localId) ?? null;
  }

  @GraphQLOperation({
    type: "Query",
    output: [ProjectArcheType],
  })
  async listProjects(_input: unknown, context: AuthContext) {
    const user = requirePermission(context, CoreResources.Projects, Action.Read);

    const allProjects = await new Query()
      .with(ProjectTag)
      .with(ProjectCoreRefComponent)
      .populate()
      .exec();

    const memberProjectIds = await this.getMemberProjectIds(user.sub);

    // Exclude sub-projects (those with a parent reference)
    // and filter by membership (admins see all)
    const isUserAdmin = user.permissions?.includes("*") ?? false;
    const rootProjects: typeof allProjects = [];
    for (const p of allProjects) {
      if (!isUserAdmin && !memberProjectIds.has(p.id)) continue;
      const parentRef = await p.get(ProjectParentRefComponent);
      if (!parentRef?.parentProjectId) {
        rootProjects.push(p);
      }
    }

    return rootProjects;
  }

  @GraphQLOperation({
    type: "Query",
    input: {
      id: t.string().required(),
    },
    output: ProjectArcheType,
  })
  async getProject(input: { id: string }, context: AuthContext) {
    const user = requirePermission(context, CoreResources.Projects, Action.Read);
    const entity = await this.findProjectEntity(input.id);
    if (!entity) {
      return new GraphQLError("Project not found", { extensions: { code: "NOT_FOUND" } });
    }

    if (!await checkProjectMember(user, entity.id)) {
      return new GraphQLError("Access denied: not a project member", { extensions: { code: "FORBIDDEN" } });
    }

    return entity;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      name: t.string().required(),
      clientId: t.string(),
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
      clientId?: string;
      description?: string;
      projectLeaderId?: string;
      ownerId?: string;
      divisionId?: string;
      commercial?: boolean;
      value?: number;
      startDate?: string;
      endDate?: string;
    },
    context: AuthContext,
  ) {
    const user = requirePermission(context, CoreResources.Projects, Action.Create);

    const authToken = extractAuthToken(context.request);

    const projectLeaderId = input.projectLeaderId ?? user.sub;

    // Create project in Core (no parentId for root projects)
    let coreProject: Awaited<ReturnType<typeof createCoreProject>>;
    try {
      coreProject = await createCoreProject(
        {
          name: input.name,
          description: input.description,
          clientId: input.clientId,
          authorId: user.sub,
          ownerId: input.ownerId,
          divisionId: input.divisionId,
          commercial: input.commercial,
          value: input.value,
          projectLeaderId,
          startDate: input.startDate,
          endDate: input.endDate,
          status: "active",
          winStage: "won",
        },
        authToken,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create project in Core";
      return new GraphQLError(message, { extensions: { code: "INTERNAL_ERROR" } });
    }

    // Create local entity
    const entity = Entity.Create()
      .add(ProjectTag, {})
      .add(ProjectCoreRefComponent, { value: coreProject.id })

    entity.add(ProjectLeaderIdComponent, { value: projectLeaderId });

    await entity.save();

    // Auto-add creator and leader as members
    await MembershipService.getInstance().ensureMembership(entity.id, user.sub);
    if (projectLeaderId !== user.sub) {
      await MembershipService.getInstance().ensureMembership(entity.id, projectLeaderId);
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
    context: AuthContext,
  ) {
    const user = requirePermission(context, CoreResources.Projects, Action.Create);

    // 1. Find parent project and get its coreRef
    const parent = await this.findProjectEntity(input.parentProjectId);
    if (!parent) {
      return new GraphQLError("Parent project not found", { extensions: { code: "NOT_FOUND" } });
    }

    // Prevent nested sub-projects (single-level nesting only)
    const parentParentRef = await parent.get(ProjectParentRefComponent);
    if (parentParentRef?.parentProjectId) {
      return new GraphQLError("Cannot create sub-projects under a sub-project", { extensions: { code: "BAD_USER_INPUT" } });
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

    // Resolve ownerId, clientId, and commercial from project leader's company
    let ownerId = input.ownerId;
    let clientId = parentCoreData.ref.clientId;
    let commercial = input.commercial;

    if (input.projectLeaderId) {
      const leaderCompanyIds = await fetchUserCompanyIds(input.projectLeaderId, authToken);
      if (leaderCompanyIds.length > 0) {
        const leaderCompanyId = leaderCompanyIds[0];
        clientId = leaderCompanyId;
        ownerId = ownerId ?? leaderCompanyId;
        commercial = commercial ?? true;
      }
    }

    // 3. Create project in Core with parentId
    let coreProject: Awaited<ReturnType<typeof createCoreProject>>;
    try {
      coreProject = await createCoreProject(
        {
          name: input.name,
          description: input.description,
          clientId,
          authorId: user.sub,
          parentId: parentCoreRef.value,
          ownerId,
          divisionId: input.divisionId,
          commercial,
          value: input.value,
          projectLeaderId: input.projectLeaderId,
          startDate: input.startDate,
          endDate: input.endDate,
          status: "active",
          winStage: "won",
        },
        authToken,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create project in Core";
      return new GraphQLError(message, { extensions: { code: "INTERNAL_ERROR" } });
    }

    // 5. Validate moduleId belongs to parent project if provided
    if (input.moduleId) {
      const moduleEntity = await new Query().findOneById(input.moduleId);
      if (!moduleEntity) {
        return new GraphQLError("Module not found", { extensions: { code: "NOT_FOUND" } });
      }
      const moduleProjectRef = await moduleEntity.get(ModuleProjectRefComponent);
      if (moduleProjectRef?.projectId !== parent.id) {
        return new GraphQLError("Module does not belong to the parent project", { extensions: { code: "BAD_USER_INPUT" } });
      }
    }

    // 6. Create local entity with coreRef pointing to new Core project
    const entity = Entity.Create()
      .add(ProjectTag, {})
      .add(ProjectParentRefComponent, { parentProjectId: parent.id })
      .add(ProjectCoreRefComponent, { value: coreProject.id })

    if (input.projectLeaderId) {
      entity.add(ProjectLeaderIdComponent, { value: input.projectLeaderId });
    }

    if (input.moduleId) {
      entity.add(ProjectModuleRefComponent, { moduleId: input.moduleId });
    }

    await entity.save();

    // 6. Auto-add creator and leader as members
    await MembershipService.getInstance().ensureMembership(entity.id, user.sub);
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
    context: AuthContext,
  ) {
    const user = requirePermission(context, CoreResources.Projects, Action.Read);
    const localParentId = await resolveLocalProjectId(input.parentProjectId);
    if (!await checkProjectMember(user, localParentId)) {
      return new GraphQLError("Access denied: not a project member", { extensions: { code: "FORBIDDEN" } });
    }
    const allSubProjects = await new Query()
      .with(ProjectTag)
      .with(ProjectCoreRefComponent)
      .with(ProjectParentRefComponent, {
        filters: [
          Query.typedFilter(ProjectParentRefComponent, "parentProjectId", "=", localParentId),
        ],
      })
      .populate()
      .exec();

    return allSubProjects;
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
  }, context: AuthContext) {
    requirePermission(context, CoreResources.Projects, Action.Update);
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
    context: AuthContext,
  ) {
    const user = requirePermission(context, CoreResources.Projects, Action.CreateAll);

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

    // Auto-add all users with tasks:projects:read_all as members
    const authToken = extractAuthToken(context.request);
    const userIds = await fetchUserIdsByPermission(
      TasksResources.Projects,
      Action.ReadAll,
      authToken,
    );

    const memberIds = new Set(userIds);
    memberIds.add(user.sub); // Always include the approver

    await Promise.all(
      Array.from(memberIds).map(id =>
        MembershipService.getInstance().ensureMembership(project.id, id)
      )
    );

    return project;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      id: t.string().required(),
    },
    output: "Boolean",
  })
  async deleteProject(input: { id: string }, context: AuthContext) {
    requireAdmin(context);
    const authToken = extractAuthToken(context.request);
    const entity = await this.findProjectEntity(input.id);

    if (!entity) {
      // Project may exist only in Core Portal (never approved locally)
      try {
        await deleteCoreProject(input.id, authToken);
      } catch {
        return new GraphQLError("Project not found", { extensions: { code: "NOT_FOUND" } });
      }
      return true;
    }

    // Delete from Core Portal (best-effort — may already be gone)
    const coreRef = await entity.get(ProjectCoreRefComponent);
    if (coreRef?.value) {
      try { await deleteCoreProject(coreRef.value, authToken); } catch { /* ignore */ }
    }

    // Cascade delete sub-projects
    const subProjects = await new Query()
      .with(ProjectTag)
      .with(ProjectParentRefComponent, {
        filters: [
          Query.typedFilter(ProjectParentRefComponent, "parentProjectId", "=", entity.id),
        ],
      })
      .populate()
      .exec();

    for (const sub of subProjects) {
      const subCoreRef = await sub.get(ProjectCoreRefComponent);
      if (subCoreRef?.value) {
        try { await deleteCoreProject(subCoreRef.value, authToken); } catch { /* ignore */ }
      }
      await sub.delete();
    }

    await entity.delete();
    return true;
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
