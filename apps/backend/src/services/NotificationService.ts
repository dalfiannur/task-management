import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import { t } from "bunsane/gql/schema";
import { Query } from "bunsane/query";
import { NotificationInfo } from "../components/NotificationInfo";
import { NotificationArcheType } from "../archetypes/NotificationArcheType";

import { parsePagination, paginateResults } from "~/lib/pagination";
import { requireUser, type AuthContext } from "~/utils/auth";

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
      page: t.int(),
      pageSize: t.int(),
    },
    output: "JSON",
  })
  async listNotifications(
    input: { page?: number; pageSize?: number },
    context: AuthContext,
  ) {
    const user = requireUser(context);
    const pg = parsePagination(input, 20);

    const entities = await new Query()
      .with(NotificationInfo, {
        filters: [
          Query.typedFilter(NotificationInfo, "recipientId", "=", user.id),
        ],
      })
      .sortBy(NotificationInfo, "createdAt", "DESC")
      .take(pg.take)
      .offset(pg.offset)
      .populate()
      .exec();

    const paginated = paginateResults(entities, pg.page, pg.pageSize);
    return {
      items: paginated.items.map((e: any) => {
        const info = e.getInMemory(NotificationInfo);
        return {
          id: e.id,
          notificationInfo: {
            recipientId: info?.recipientId ?? "",
            type: info?.type ?? "",
            actorId: info?.actorId ?? "",
            actorName: info?.actorName ?? "",
            taskId: info?.taskId ?? "",
            taskTitle: info?.taskTitle ?? "",
            commentId: info?.commentId ?? "",
            message: info?.message ?? "",
            read: info?.read ?? "false",
            createdAt: info?.createdAt ?? "",
          },
        };
      }),
      pageInfo: paginated.pageInfo,
    };
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
    context: AuthContext,
  ) {
    const user = requireUser(context);

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
    context: AuthContext,
  ) {
    const user = requireUser(context);

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
    context: AuthContext,
  ) {
    const user = requireUser(context);

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
