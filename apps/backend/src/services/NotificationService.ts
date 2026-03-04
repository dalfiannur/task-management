import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import { t } from "bunsane/gql/schema";
import { Query } from "bunsane/query";
import { NotificationInfo } from "../components/NotificationInfo";
import { NotificationArcheType } from "../archetypes/NotificationArcheType";

import { requireAuth, type TaskAuthUser } from "~/lib/auth-context";

const notificationArcheType = new NotificationArcheType();

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
    input: {
      limit: t.int(),
      offset: t.int(),
    },
    output: [notificationArcheType],
  })
  async listNotifications(
    input: { limit?: number; offset?: number },
    context: { user?: TaskAuthUser | null },
  ) {
    const user = requireAuth(context);

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
    input: {
      _dummy: t.boolean(),
    },
    output: "Int",
  })
  async unreadNotificationCount(
    _input: { _dummy?: boolean },
    context: { user?: TaskAuthUser | null },
  ) {
    const user = requireAuth(context);

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
    input: {
      ids: t.list(t.string()).required(),
    },
    output: "Boolean",
  })
  async markNotificationsRead(
    input: { ids: string[] },
    context: { user?: TaskAuthUser | null },
  ) {
    const user = requireAuth(context);

    if (input.ids.length === 0) return true;

    // Fetch all notifications in parallel
    const entities = await Promise.all(
      input.ids.map((id) => new Query().findOneById(id))
    );

    for (const entity of entities) {
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
    input: {
      _dummy: t.boolean(),
    },
    output: "Boolean",
  })
  async markAllNotificationsRead(
    _input: { _dummy?: boolean },
    context: { user?: TaskAuthUser | null },
  ) {
    const user = requireAuth(context);

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
