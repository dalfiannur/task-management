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
    const query = new Query()
      .with(ProjectTag)
      .with(ProjectCoreRefComponent)
      .with(ProjectStatusComponent);
    const allProjects = await query.populate().exec();

    const user = await this.extractUser(context);
    let filteredProjects = allProjects;
    if (user) {
      const role = user.role ?? await getUserRole(user.id);
      if (role !== "manager") {
        const memberProjectIds = await this.getMemberProjectIds(user.id);
        filteredProjects = allProjects.filter((p: any) => memberProjectIds.has(p.id));
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
    if (!entity) throw new Error("Project not found");

    const user = await this.extractUser(context);
    if (user) {
      const role = user.role ?? await getUserRole(user.id);
      if (role !== "manager") {
        const memberProjectIds = await this.getMemberProjectIds(user.id);
        if (!memberProjectIds.has(input.id)) throw new Error("Access denied");
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
      parentProjectId: z.string(),
      name: z.string(),
      description: z.string().optional(),
      projectLeaderId: z.string().optional(),
    }),
    output: ProjectArcheType,
  })
  async createSubProject(
    input: {
      parentProjectId: string;
      name: string;
      description?: string;
      projectLeaderId?: string;
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

    if (input.projectLeaderId) {
      entity.add(ProjectLeaderIdComponent, { value: input.projectLeaderId });
    }

    await entity.save();

    // Auto-add creator and leader as members
    const user = await this.extractUser(context);
    if (user) {
      await MembershipService.getInstance().ensureMembership(entity.id, user.id);
    }
    if (input.projectLeaderId) {
      await MembershipService.getInstance().ensureMembership(entity.id, input.projectLeaderId);
    }

    enrichEntity(entity, null, "on_going");
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
    let filteredProjects = allSubProjects;
    if (user) {
      const role = user.role ?? await getUserRole(user.id);
      if (role !== "manager") {
        const memberProjectIds = await this.getMemberProjectIds(user.id);
        filteredProjects = allSubProjects.filter((p: any) => memberProjectIds.has(p.id));
      }
    }

    // Sub-projects have no coreRef, enrich with null
    for (const entity of filteredProjects) {
      const statusComp = entity.getInMemory(ProjectStatusComponent);
      enrichEntity(entity, null, statusComp?.value ?? "on_going");
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
    }),
    output: ProjectArcheType,
  })
  async updateProject(input: {
    id: string;
    name?: string;
    description?: string;
    status?: string;
    projectLeaderId?: string;
  }, context: { request?: Request }) {
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

    if (input.projectLeaderId) {
      await entity.set(ProjectLeaderIdComponent, { value: input.projectLeaderId });
      // Auto-add leader as member
      await MembershipService.getInstance().ensureMembership(input.id, input.projectLeaderId);
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
