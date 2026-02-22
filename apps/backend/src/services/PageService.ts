import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import { Query } from "bunsane/query";
import { z } from "zod";
import { PageInfo } from "../components/PageInfo";
import { PageArcheType } from "../archetypes/PageArcheType";
import { AuthPlugin } from "../plugins/AuthPlugin";

const pageArcheType = new PageArcheType();

async function requireUser(context: { request?: Request }) {
  if (!context.request) throw new Error("Authentication required");
  const user = await AuthPlugin.extractUser(context.request);
  if (!user) throw new Error("Authentication required");
  return user;
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
    type: "Mutation",
    input: z.object({
      projectId: z.string(),
      title: z.string(),
      icon: z.string().optional(),
      content: z.string().optional(),
    }),
    output: pageArcheType,
  })
  async createPage(
    input: { projectId: string; title: string; icon?: string; content?: string },
    context: { request?: Request },
  ) {
    const user = await requireUser(context);

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
    }),
    output: pageArcheType,
  })
  async updatePage(
    input: { id: string; title?: string; icon?: string; content?: string; order?: number },
    context: { request?: Request },
  ) {
    const user = await requireUser(context);

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
    context: { request?: Request },
  ) {
    await requireUser(context);

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
    context: { request?: Request },
  ) {
    await requireUser(context);

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
