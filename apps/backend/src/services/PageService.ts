import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import { t } from "bunsane/gql/schema";
import { Query } from "bunsane/query";
import { PageInfo } from "../components/PageInfo";
import { PageArcheType } from "../archetypes/PageArcheType";
import { resolveLocalProjectId } from "~/lib/resolve-project-id";
import { requirePermission, type AuthContext, TaskResources, Action } from "~/utils/auth";

const pageArcheType = new PageArcheType();

export default class PageService extends BaseService {
  constructor() {
    super();
    pageArcheType.registerFieldResolvers(this);
  }

  @GraphQLOperation({
    type: "Query",
    input: {
      projectId: t.string().required(),
    },
    output: [pageArcheType],
  })
  async listPages(input: { projectId: string }, context: AuthContext) {
    requirePermission(context, TaskResources.Tasks, Action.Read);
    const localProjectId = await resolveLocalProjectId(input.projectId);
    return await new Query()
      .with(PageInfo, {
        filters: [
          Query.typedFilter(PageInfo, "projectId", "=", localProjectId),
        ],
      })
      .sortBy(PageInfo, "order", "ASC")
      .populate()
      .exec();
  }

  @GraphQLOperation({
    type: "Query",
    input: {
      id: t.string().required(),
    },
    output: pageArcheType,
  })
  async getPage(input: { id: string }, context: AuthContext) {
    requirePermission(context, TaskResources.Tasks, Action.Read);
    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Page not found");
    return entity;
  }

  @GraphQLOperation({
    type: "Query",
    input: {
      taskId: t.string().required(),
    },
    output: [pageArcheType],
  })
  async listPagesByTask(input: { taskId: string }, context: AuthContext) {
    requirePermission(context, TaskResources.Tasks, Action.Read);
    return await new Query()
      .with(PageInfo, {
        filters: [
          Query.typedFilter(PageInfo, "linkedTaskId", "=", input.taskId),
        ],
      })
      .populate()
      .exec();
  }

  @GraphQLOperation({
    type: "Query",
    input: {
      moduleId: t.string().required(),
    },
    output: [pageArcheType],
  })
  async listPagesByModule(input: { moduleId: string }, context: AuthContext) {
    requirePermission(context, TaskResources.Tasks, Action.Read);
    return await new Query()
      .with(PageInfo, {
        filters: [
          Query.typedFilter(PageInfo, "linkedModuleId", "=", input.moduleId),
        ],
      })
      .populate()
      .exec();
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      projectId: t.string().required(),
      title: t.string().required(),
      icon: t.string(),
      content: t.string(),
      linkedTaskId: t.string(),
      linkedModuleId: t.string(),
    },
    output: pageArcheType,
  })
  async createPage(
    input: {
      projectId: string;
      title: string;
      icon?: string;
      content?: string;
      linkedTaskId?: string;
      linkedModuleId?: string;
    },
    context: AuthContext,
  ) {
    const user = requirePermission(context, TaskResources.Tasks, Action.Create);

    if (input.linkedTaskId && input.linkedModuleId) {
      throw new Error("A page can only be linked to a task or a module, not both");
    }

    const localProjectId = await resolveLocalProjectId(input.projectId);

    // Determine next order value
    const existing = await new Query()
      .with(PageInfo, {
        filters: [
          Query.typedFilter(PageInfo, "projectId", "=", localProjectId),
        ],
      })
      .populate()
      .exec();
    const maxOrder = existing.length;

    const displayName = user.name ?? user.email ?? user.sub;
    const now = new Date().toISOString();
    const archetype = new PageArcheType();
    archetype.fill({
      pageInfo: {
        projectId: localProjectId,
        title: input.title,
        icon: input.icon ?? "",
        content: input.content ?? "",
        order: maxOrder,
        createdById: user.sub,
        createdByName: displayName,
        lastEditedById: user.sub,
        lastEditedByName: displayName,
        createdAt: now,
        updatedAt: now,
        linkedTaskId: input.linkedTaskId ?? "",
        linkedModuleId: input.linkedModuleId ?? "",
      },
    });

    const entity = await archetype.createAndSaveEntity();
    return entity;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      id: t.string().required(),
      title: t.string(),
      icon: t.string(),
      content: t.string(),
      order: t.int(),
      linkedTaskId: t.string(),
      linkedModuleId: t.string(),
    },
    output: pageArcheType,
  })
  async updatePage(
    input: {
      id: string;
      title?: string;
      icon?: string;
      content?: string;
      order?: number;
      linkedTaskId?: string;
      linkedModuleId?: string;
    },
    context: AuthContext,
  ) {
    const user = requirePermission(context, TaskResources.Tasks, Action.Update);

    // Validate mutual exclusivity
    const hasTaskLink = input.linkedTaskId !== undefined && input.linkedTaskId !== "";
    const hasModuleLink = input.linkedModuleId !== undefined && input.linkedModuleId !== "";
    if (hasTaskLink && hasModuleLink) {
      throw new Error("A page can only be linked to a task or a module, not both");
    }

    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Page not found");

    const updates: Record<string, unknown> = {
      lastEditedById: user.sub,
      lastEditedByName: user.name ?? user.email ?? user.sub,
      updatedAt: new Date().toISOString(),
    };

    if (input.title !== undefined) updates.title = input.title;
    if (input.icon !== undefined) updates.icon = input.icon;
    if (input.content !== undefined) updates.content = input.content;
    if (input.order !== undefined) updates.order = input.order;

    // When linking to a task, clear module link and vice versa
    if (input.linkedTaskId !== undefined) {
      updates.linkedTaskId = input.linkedTaskId;
      if (input.linkedTaskId !== "") updates.linkedModuleId = "";
    }
    if (input.linkedModuleId !== undefined) {
      updates.linkedModuleId = input.linkedModuleId;
      if (input.linkedModuleId !== "") updates.linkedTaskId = "";
    }

    await entity.set(PageInfo, updates);
    await entity.save();

    return entity;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      id: t.string().required(),
    },
    output: "Boolean",
  })
  async deletePage(
    input: { id: string },
    context: AuthContext,
  ) {
    requirePermission(context, TaskResources.Tasks, Action.Delete);

    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Page not found");

    await entity.delete();
    return true;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      projectId: t.string().required(),
      pageIds: t.list(t.string()).required(),
    },
    output: "Boolean",
  })
  async reorderPages(
    input: { projectId: string; pageIds: string[] },
    context: AuthContext,
  ) {
    requirePermission(context, TaskResources.Tasks, Action.Update);

    if (input.pageIds.length === 0) return true;

    // Fetch all pages in parallel
    const entities = await Promise.all(
      input.pageIds.map((id) => new Query().findOneById(id))
    );

    // Update order for each page
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      if (entity) {
        await entity.set(PageInfo, { order: i });
        await entity.save();
      }
    }

    return true;
  }
}
