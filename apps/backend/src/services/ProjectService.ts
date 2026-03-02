import { BaseService } from "bunsane/service";
import { GraphQLOperation } from 'bunsane/gql';
import { Entity } from 'bunsane/core/Entity';
import { Query } from 'bunsane/query';
import { GraphQLError } from "graphql";
import { z } from "zod";
import { ProjectArcheType } from "../archetypes/ProjectArcheType";
import {
  ProjectCoreRefComponent,
  ProjectDescriptionComponent,
  ProjectNameComponent,
  ProjectParentRefComponent,
  ProjectModuleRefComponent,
  ProjectLeaderIdComponent,
  ProjectStatusComponent,
  ProjectTag,
  ProjectCodeComponent,
  ProjectCoreNameComponent,
  ProjectCoreDescriptionComponent,
  ProjectClientNameComponent,
  ProjectClientLegalNameComponent,
  ProjectWinStageComponent,
  ProjectResolvedStatusComponent,
  ProjectClosedAtComponent,
} from "~/components/ProjectComponents";
import {
  ModuleDescriptionComponent,
  ModuleNameComponent,
  ModuleProjectRefComponent,
  ModuleTag,
} from "~/components/ModuleComponents";
import { ProjectMembershipData } from "~/components/ProjectMembership";
import { AuthPlugin } from "~/plugins/AuthPlugin";
import { getUserRole, requireManager } from "./UserService";
import MembershipService from "./MembershipService";
import {
  fetchCoreProject,
  fetchCoreProjects,
  createCoreProject,
  extractAuthToken,
  type CoreProject,
} from "~/lib/core-client";

function computeResolvedStatus(localStatus: string, coreWinStage?: string): string {
  if (coreWinStage === "won" && localStatus === "prospect") return "won";
  return localStatus;
}

/** Add enrichment components in memory (not persisted). */
function enrichEntity(entity: Entity, coreData: CoreProject | null, localStatus: string) {
  entity.add(ProjectCodeComponent, { value: coreData?.code ?? "" });
  entity.add(ProjectCoreNameComponent, { value: coreData?.name.name ?? "" });
  entity.add(ProjectCoreDescriptionComponent, { value: coreData?.name.description ?? "" });
  entity.add(ProjectClientNameComponent, { value: coreData?.clientDetail?.name.name ?? "" });
  entity.add(ProjectClientLegalNameComponent, { value: coreData?.clientDetail?.name.legalName ?? "" });
  entity.add(ProjectWinStageComponent, { value: coreData?.winStage ?? "" });
  entity.add(ProjectResolvedStatusComponent, { value: computeResolvedStatus(localStatus, coreData?.winStage) });
}

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
    const allProjects = await new Query()
      .with(ProjectTag)
      .with(ProjectCoreRefComponent)
      .with(ProjectStatusComponent)
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

    const user = await this.extractUser(context);
    let filteredProjects = rootProjects;
    if (user) {
      const role = user.role ?? await getUserRole(user.id);
      if (role !== "manager") {
        const memberProjectIds = await this.getMemberProjectIds(user.id);
        filteredProjects = rootProjects.filter((p: any) => memberProjectIds.has(p.id));
      }
    }

    // Collect coreRef IDs for enrichment
    const coreRefEntries: { entity: any; coreRefId: string }[] = [];
    for (const entity of filteredProjects) {
      const coreRef = entity.getInMemory(ProjectCoreRefComponent);
      if (coreRef?.value && coreRef.value !== "") {
        coreRefEntries.push({ entity, coreRefId: coreRef.value });
      }
    }
    const uniqueIds = [...new Set(coreRefEntries.map((e) => e.coreRefId))];

    const authToken = extractAuthToken(context.request);
    const coreMap = uniqueIds.length > 0
      ? await fetchCoreProjects(uniqueIds, authToken)
      : new Map<string, CoreProject>();

    // Sync leader from Core and enrich entities in memory
    for (const entity of filteredProjects) {
      const coreRef = entity.getInMemory(ProjectCoreRefComponent);
      const coreRefId = coreRef?.value;
      const coreData = coreRefId ? coreMap.get(coreRefId) ?? null : null;
      const statusComp = entity.getInMemory(ProjectStatusComponent);
      const localStatus = statusComp?.value ?? "prospect";

      // Sync leader from Core if different
      if (coreData?.ref?.leaderId) {
        const leaderComp = entity.getInMemory(ProjectLeaderIdComponent);
        if (leaderComp?.value !== coreData.ref.leaderId) {
          await entity.set(ProjectLeaderIdComponent, { value: coreData.ref.leaderId });
          await entity.save();
        }
      }

      // Add enrichment components (in memory only, not saved)
      enrichEntity(entity, coreData, localStatus);
    }

    return filteredProjects;
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
    if (!entity) {
      return new GraphQLError("Project not found", { extensions: { code: "NOT_FOUND" } });
    }

    const user = await this.extractUser(context);
    if (user) {
      const role = user.role ?? await getUserRole(user.id);
      if (role !== "manager") {
        const memberProjectIds = await this.getMemberProjectIds(user.id);
        if (!memberProjectIds.has(input.id)) {
          const parentRef = await entity.get(ProjectParentRefComponent);
          if (!parentRef?.parentProjectId || !memberProjectIds.has(parentRef.parentProjectId)) {
            return new GraphQLError("Access denied", { extensions: { code: "FORBIDDEN" } });
          }
        }
      }
    }

    const coreRef = await entity.get(ProjectCoreRefComponent);
    const statusComp = await entity.get(ProjectStatusComponent);
    const localStatus = statusComp?.value ?? "prospect";

    if (coreRef?.value) {
      const authToken = extractAuthToken(context.request);
      const coreData = await fetchCoreProject(coreRef.value, authToken);

      // Sync leader from Core
      if (coreData?.ref?.leaderId) {
        const leaderComp = await entity.get(ProjectLeaderIdComponent);
        if (leaderComp?.value !== coreData.ref.leaderId) {
          await entity.set(ProjectLeaderIdComponent, { value: coreData.ref.leaderId });
          await entity.save();
        }
      }

      enrichEntity(entity, coreData, localStatus);
    } else {
      enrichEntity(entity, null, localStatus);
    }

    return entity;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      name: z.string(),
      clientId: z.string(),
      description: z.string().optional(),
      projectLeaderId: z.string().optional(),
      ownerId: z.string().optional(),
      divisionId: z.string().optional(),
      commercial: z.boolean().optional(),
      value: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }),
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
    context: { request?: Request },
  ) {
    const user = await this.extractUser(context);
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
      .add(ProjectNameComponent, { value: input.name })
      .add(ProjectCoreRefComponent, { value: coreProject.id })
      .add(ProjectDescriptionComponent, { value: input.description || "" })
      .add(ProjectStatusComponent, { value: "on_going" });

    if (input.projectLeaderId) {
      entity.add(ProjectLeaderIdComponent, { value: input.projectLeaderId });
    }

    await entity.save();

    // Auto-add creator and leader as members
    await MembershipService.getInstance().ensureMembership(entity.id, user.id);
    if (input.projectLeaderId) {
      await MembershipService.getInstance().ensureMembership(entity.id, input.projectLeaderId);
    }

    // Enrich with Core data and return
    enrichEntity(entity, coreProject, "on_going");
    return entity;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      parentProjectId: z.string(),
      name: z.string(),
      description: z.string().optional(),
      projectLeaderId: z.string().optional(),
      ownerId: z.string().optional(),
      divisionId: z.string().optional(),
      commercial: z.boolean().optional(),
      value: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      moduleId: z.string().optional(),
    }),
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
    context: { request?: Request },
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
    const user = await this.extractUser(context);
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
      .add(ProjectNameComponent, { value: input.name })
      .add(ProjectParentRefComponent, { parentProjectId: input.parentProjectId })
      .add(ProjectCoreRefComponent, { value: coreProject.id })
      .add(ProjectDescriptionComponent, { value: input.description || "" })
      .add(ProjectStatusComponent, { value: "on_going" });

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

    // 7. Enrich with Core data and return
    enrichEntity(entity, coreProject, "on_going");
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
      .with(ProjectCoreRefComponent)
      .with(ProjectStatusComponent)
      .with(ProjectParentRefComponent, {
        filters: [
          Query.typedFilter(ProjectParentRefComponent, "parentProjectId", "=", input.parentProjectId),
        ],
      })
      .populate()
      .exec();

    const user = await this.extractUser(context);
    let filteredProjects = allSubProjects;
    if (user) {
      const role = user.role ?? await getUserRole(user.id);
      if (role !== "manager") {
        const memberProjectIds = await this.getMemberProjectIds(user.id);
        if (!memberProjectIds.has(input.parentProjectId)) {
          filteredProjects = allSubProjects.filter((p: any) => memberProjectIds.has(p.id));
        }
      }
    }

    // Collect coreRef IDs for enrichment (sub-projects with Core refs)
    const coreRefEntries: { entity: any; coreRefId: string }[] = [];
    for (const entity of filteredProjects) {
      const coreRef = entity.getInMemory(ProjectCoreRefComponent);
      if (coreRef?.value && coreRef.value !== "") {
        coreRefEntries.push({ entity, coreRefId: coreRef.value });
      }
    }

    const uniqueIds = [...new Set(coreRefEntries.map((e) => e.coreRefId))];
    const authToken = extractAuthToken(context.request);
    const coreMap = uniqueIds.length > 0
      ? await fetchCoreProjects(uniqueIds, authToken)
      : new Map<string, CoreProject>();

    // Enrich each entity — Core-backed sub-projects get real data, legacy ones get null
    for (const entity of filteredProjects) {
      const coreRef = entity.getInMemory(ProjectCoreRefComponent);
      const coreRefId = coreRef?.value;
      const coreData = coreRefId ? coreMap.get(coreRefId) ?? null : null;
      const statusComp = entity.getInMemory(ProjectStatusComponent);
      enrichEntity(entity, coreData, statusComp?.value ?? "on_going");
    }

    return filteredProjects;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      status: z.string().optional(),
      projectLeaderId: z.string().optional(),
      moduleId: z.string().nullable().optional(),
    }),
    output: ProjectArcheType,
  })
  async updateProject(input: {
    id: string;
    name?: string;
    description?: string;
    status?: string;
    projectLeaderId?: string;
    moduleId?: string | null;
  }, context: { request?: Request }) {
    const entity = await new Query().findOneById(input.id);
    if (!entity) {
      return new GraphQLError("Project not found", { extensions: { code: "NOT_FOUND" } });
    }

    if (input.name) {
      await entity.set(ProjectNameComponent, { value: input.name });
    }

    if (input.status) {
      await entity.set(ProjectStatusComponent, { value: input.status });
    }

    if (input.description) {
      await entity.set(ProjectDescriptionComponent, { value: input.description });
    }

    if (input.projectLeaderId) {
      await entity.set(ProjectLeaderIdComponent, { value: input.projectLeaderId });
      // Auto-add leader as member
      await MembershipService.getInstance().ensureMembership(input.id, input.projectLeaderId);
    }

    // Handle moduleId: string → set, null → remove, undefined → no change
    if (input.moduleId !== undefined) {
      if (input.moduleId === null) {
        await entity.remove(ProjectModuleRefComponent);
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

    // Enrich with Core data
    const coreRef = await entity.get(ProjectCoreRefComponent);
    const statusComp = await entity.get(ProjectStatusComponent);
    const localStatus = statusComp?.value ?? "prospect";

    if (coreRef?.value) {
      const authToken = extractAuthToken(context.request);
      const coreData = await fetchCoreProject(coreRef.value, authToken);
      enrichEntity(entity, coreData, localStatus);
    } else {
      enrichEntity(entity, null, localStatus);
    }

    return entity;
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
      .add(ProjectCoreRefComponent, { value: args.id })
      .add(ProjectDescriptionComponent, { value: args.description || "" })
      .add(ProjectStatusComponent, { value: "prospect" });

    await project.save();

    const module = Entity.Create()
      .add(ModuleTag, {})
      .add(ModuleProjectRefComponent, { projectId: project.id })
      .add(ModuleNameComponent, { value: "Proposal" })
      .add(ModuleDescriptionComponent, { value: "" });

    await module.save();

    // Auto-add approver as member
    await MembershipService.getInstance().ensureMembership(project.id, user.id);

    // Enrich with Core data
    const authToken = extractAuthToken(context.request);
    const coreData = await fetchCoreProject(args.id, authToken);
    enrichEntity(project, coreData, "prospect");

    return project;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      id: z.string(),
    }),
    output: ProjectArcheType,
  })
  async closeProject(input: { id: string }, context: { request?: Request }) {
    const entity = await new Query().findOneById(input.id);
    if (!entity) {
      return new GraphQLError("Project not found", { extensions: { code: "NOT_FOUND" } });
    }

    const statusComp = await entity.get(ProjectStatusComponent);
    if (statusComp?.value !== "on_going") {
      return new GraphQLError("Only on_going projects can be closed", { extensions: { code: "BAD_USER_INPUT" } });
    }

    await entity.set(ProjectStatusComponent, { value: "closed" });
    await entity.set(ProjectClosedAtComponent, { value: new Date().toISOString() });
    await entity.save();

    // Enrich with Core data
    const coreRef = await entity.get(ProjectCoreRefComponent);
    if (coreRef?.value) {
      const authToken = extractAuthToken(context.request);
      const coreData = await fetchCoreProject(coreRef.value, authToken);
      enrichEntity(entity, coreData, "closed");
    } else {
      enrichEntity(entity, null, "closed");
    }

    return entity;
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
    if (!entity) {
      return new GraphQLError("Project not found", { extensions: { code: "NOT_FOUND" } });
    }
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
