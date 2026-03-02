import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import { Query } from "bunsane/query";
import { z } from "zod";
import { PageInfo } from "../components/PageInfo";
import { PageArcheType } from "../archetypes/PageArcheType";

const pageArcheType = new PageArcheType();

type AuthUser = { id: string; sub: string; email: string; name: string; picture?: string; role?: string };

function requireUser(context: { user?: AuthUser }) {
  if (!context.user) throw new Error("Authentication required");
  const user = context.user;
  const id = user.id || user.sub;
  const name = user.name?.trim() || user.email?.trim() || user.sub;
  return { ...user, id, name };
}

export default class PageService extends BaseService {
  constructor() {
    super();
    pageArcheType.registerFieldResolvers(this);
  }

  @GraphQLOperation({
    type: "Query",
    input: z.object({
      projectId: z.string(),
    }),
    output: [pageArcheType],
  })
  async listPages(input: { projectId: string }) {
    const entities = await new Query()
      .with(PageInfo, {
        filters: [
          Query.typedFilter(PageInfo, "projectId", "=", input.projectId),
        ],
      })
      .populate()
      .exec();

    // Sort by order ASC, then createdAt ASC
    const sorted = await Promise.all(
      entities.map(async (e: any) => ({
        entity: e,
        info: await e.get(PageInfo),
      })),
    );
    sorted.sort((a, b) => {
      const orderDiff = (a.info?.order ?? 0) - (b.info?.order ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return (a.info?.createdAt ?? "").localeCompare(b.info?.createdAt ?? "");
    });
    return sorted.map((s) => s.entity);
  }

  @GraphQLOperation({
    type: "Query",
    input: z.object({
      id: z.string(),
    }),
    output: pageArcheType,
  })
  async getPage(input: { id: string }) {
    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Page not found");
    return entity;
  }

  @GraphQLOperation({
    type: "Query",
    input: z.object({
      taskId: z.string(),
    }),
    output: [pageArcheType],
  })
  async listPagesByTask(input: { taskId: string }) {
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
    input: z.object({
      moduleId: z.string(),
    }),
    output: [pageArcheType],
  })
  async listPagesByModule(input: { moduleId: string }) {
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
    input: z.object({
      projectId: z.string(),
      title: z.string(),
      icon: z.string().optional(),
      content: z.string().optional(),
      linkedTaskId: z.string().optional(),
      linkedModuleId: z.string().optional(),
    }),
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
    context: { user?: AuthUser },
  ) {
    const user = requireUser(context);

    if (input.linkedTaskId && input.linkedModuleId) {
      throw new Error("A page can only be linked to a task or a module, not both");
    }

    // Determine next order value
    const existing = await new Query()
      .with(PageInfo, {
        filters: [
          Query.typedFilter(PageInfo, "projectId", "=", input.projectId),
        ],
      })
      .populate()
      .exec();
    const maxOrder = existing.length;

    const now = new Date().toISOString();
    const archetype = new PageArcheType();
    archetype.fill({
      pageInfo: {
        projectId: input.projectId,
        title: input.title,
        icon: input.icon ?? "",
        content: input.content ?? "",
        order: maxOrder,
        createdById: user.id,
        createdByName: user.name,
        lastEditedById: user.id,
        lastEditedByName: user.name,
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
    input: z.object({
      id: z.string(),
      title: z.string().optional(),
      icon: z.string().optional(),
      content: z.string().optional(),
      order: z.number().optional(),
      linkedTaskId: z.string().optional(),
      linkedModuleId: z.string().optional(),
    }),
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
    context: { user?: AuthUser },
  ) {
    const user = requireUser(context);

    // Validate mutual exclusivity
    const hasTaskLink = input.linkedTaskId !== undefined && input.linkedTaskId !== "";
    const hasModuleLink = input.linkedModuleId !== undefined && input.linkedModuleId !== "";
    if (hasTaskLink && hasModuleLink) {
      throw new Error("A page can only be linked to a task or a module, not both");
    }

    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Page not found");

    const updates: Record<string, unknown> = {
      lastEditedById: user.id,
      lastEditedByName: user.name,
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
    input: z.object({
      id: z.string(),
    }),
    output: "Boolean",
  })
  async deletePage(
    input: { id: string },
    context: { user?: AuthUser },
  ) {
    requireUser(context);

    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Page not found");

    await entity.delete();
    return true;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      projectId: z.string(),
      pageIds: z.array(z.string()),
    }),
    output: "Boolean",
  })
  async reorderPages(
    input: { projectId: string; pageIds: string[] },
    context: { user?: AuthUser },
  ) {
    requireUser(context);

    for (let i = 0; i < input.pageIds.length; i++) {
      const entity = await new Query().findOneById(input.pageIds[i]);
      if (entity) {
        await entity.set(PageInfo, { order: i });
        await entity.save();
      }
    }

    return true;
  }
}
