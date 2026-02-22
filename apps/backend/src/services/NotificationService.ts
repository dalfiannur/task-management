import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import { Query } from "bunsane/query";
import { z } from "zod";
import { NotificationInfo } from "../components/NotificationInfo";
import { NotificationArcheType } from "../archetypes/NotificationArcheType";
import { AuthPlugin } from "../plugins/AuthPlugin";

const notificationArcheType = new NotificationArcheType();

async function requireUser(context: { request?: Request }) {
  if (!context.request) throw new Error("Authentication required");
  const user = await AuthPlugin.extractUser(context.request);
  if (!user) throw new Error("Authentication required");
  return user;
}

export default class NotificationService extends BaseService {
  private static instance: NotificationService;

  constructor() {
    super();
    notificationArcheType.registerFieldResolvers(this);
    NotificationService.instance = this;
  }

  static getInstance(): NotificationService {
    return NotificationService.instance;
  }

  /**
   * Internal helper — called by other services to create notifications.
   * No-ops if recipientId === actorId (self-notification).
   */
  async createNotification(params: {
    recipientId: string;
    type: string;
    actorId: string;
    actorName: string;
    taskId: string;
    taskTitle: string;
    commentId?: string;
    message: string;
  }): Promise<void> {
    // Guard against self-notification
    if (params.recipientId === params.actorId) return;

    const archetype = new NotificationArcheType();
    archetype.fill({
      notificationInfo: {
        recipientId: params.recipientId,
        type: params.type,
        actorId: params.actorId,
        actorName: params.actorName,
        taskId: params.taskId,
        taskTitle: params.taskTitle,
        commentId: params.commentId ?? "",
        message: params.message,
        read: "false",
        createdAt: new Date().toISOString(),
      },
    });

    await archetype.createAndSaveEntity();
  }

  @GraphQLOperation({
    type: "Query",
    input: z.object({
      limit: z.number().optional(),
      offset: z.number().optional(),
    }),
    output: [notificationArcheType],
  })
  async listNotifications(
    input: { limit?: number; offset?: number },
    context: { request?: Request },
  ) {
    const user = await requireUser(context);

    const query = new Query()
      .with(NotificationInfo, {
        filters: [
          Query.typedFilter(NotificationInfo, "recipientId", "=", user.id),
        ],
      })
      .sortBy(NotificationInfo, "createdAt", "DESC")
      .take(input.limit ?? 50)
      .offset(input.offset ?? 0);

    return await query.populate().exec();
  }

  @GraphQLOperation({
    type: "Query",
    input: z.object({
      _dummy: z.boolean().optional(),
    }),
    output: "Int",
  })
  async unreadNotificationCount(
    _input: { _dummy?: boolean },
    context: { request?: Request },
  ) {
    const user = await requireUser(context);

    const entities = await new Query()
      .with(NotificationInfo, {
        filters: [
          Query.typedFilter(NotificationInfo, "recipientId", "=", user.id),
          Query.typedFilter(NotificationInfo, "read", "=", "false"),
        ],
      })
      .exec();

    return entities.length;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      ids: z.array(z.string()),
    }),
    output: "Boolean",
  })
  async markNotificationsRead(
    input: { ids: string[] },
    context: { request?: Request },
  ) {
    const user = await requireUser(context);

    for (const id of input.ids) {
      const entity = await new Query().findOneById(id);
      if (!entity) continue;

      const info = await entity.get(NotificationInfo);
      if (info?.recipientId !== user.id) continue;

      await entity.set(NotificationInfo, { read: "true" });
      await entity.save();
    }

    return true;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      _dummy: z.boolean().optional(),
    }),
    output: "Boolean",
  })
  async markAllNotificationsRead(
    _input: { _dummy?: boolean },
    context: { request?: Request },
  ) {
    const user = await requireUser(context);

    const entities = await new Query()
      .with(NotificationInfo, {
        filters: [
          Query.typedFilter(NotificationInfo, "recipientId", "=", user.id),
          Query.typedFilter(NotificationInfo, "read", "=", "false"),
        ],
      })
      .exec();

    for (const entity of entities) {
      await entity.set(NotificationInfo, { read: "true" });
      await entity.save();
    }

    return true;
  }
}
