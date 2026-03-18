import { BaseService } from "bunsane/service";
import { GraphQLOperation, GraphQLScalarType } from "bunsane/gql";
import { t } from "bunsane/gql/schema";
import { Query } from "bunsane/query";
import { CommentInfo } from "../components/CommentInfo";
import { CommentArcheType } from "../archetypes/CommentArcheType";
import { TaskInfo } from "../components/TaskInfo";
import NotificationService from "./NotificationService";

import { parsePagination, paginateResults } from "~/lib/pagination";
import { requirePermission, type AuthContext, TasksResources, Action } from "~/utils/auth";

const commentArcheType = new CommentArcheType();

@GraphQLScalarType("JSON")
export default class CommentService extends BaseService {
  constructor() {
    super();
    commentArcheType.registerFieldResolvers(this);
  }

  @GraphQLOperation({
    type: "Query",
    input: {
      taskId: t.string().required(),
      page: t.int(),
      pageSize: t.int(),
    },
    output: "JSON",
  })
  async listComments(input: { taskId: string; page?: number; pageSize?: number }, context: AuthContext) {
    requirePermission(context, TasksResources.Tasks, Action.Read);
    const pg = parsePagination(input, 30);
    const entities = await new Query()
      .with(CommentInfo, {
        filters: [
          Query.typedFilter(CommentInfo, "taskId", "=", input.taskId),
        ],
      })
      .sortBy(CommentInfo, "createdAt", "ASC")
      .take(pg.take)
      .offset(pg.offset)
      .populate()
      .exec();

    const paginated = paginateResults(entities, pg.page, pg.pageSize);
    return {
      items: paginated.items.map((e: any) => {
        const info = e.getInMemory(CommentInfo);
        return {
          id: e.id,
          commentInfo: {
            taskId: info?.taskId ?? "",
            authorId: info?.authorId ?? "",
            authorName: info?.authorName ?? "",
            content: info?.content ?? "",
            createdAt: info?.createdAt ?? "",
            updatedAt: info?.updatedAt ?? "",
            mentionedUserIds: info?.mentionedUserIds ?? "[]",
          },
        };
      }),
      pageInfo: paginated.pageInfo,
    };
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      taskId: t.string().required(),
      content: t.string().required(),
      mentionedUserIds: t.list(t.string()),
    },
    output: commentArcheType,
  })
  async createComment(
    input: { taskId: string; content: string; mentionedUserIds?: string[] },
    context: AuthContext,
  ) {
    const user = requirePermission(context, TasksResources.Tasks, Action.Create);
    const mentionedIds = input.mentionedUserIds ?? [];

    const now = new Date().toISOString();
    const archetype = new CommentArcheType();
    archetype.fill({
      commentInfo: {
        taskId: input.taskId,
        authorId: user.sub,
        authorName: user.name ?? user.email ?? user.sub,
        content: input.content,
        createdAt: now,
        updatedAt: now,
        mentionedUserIds: JSON.stringify(mentionedIds),
      },
    });

    const entity = await archetype.createAndSaveEntity();

    // Create mention notifications
    if (mentionedIds.length > 0) {
      const taskEntity = await new Query().findOneById(input.taskId);
      const taskInfo = taskEntity ? await taskEntity.get(TaskInfo) : null;
      const taskTitle = taskInfo?.title ?? "a task";

      const notificationService = NotificationService.getInstance();
      const displayName = user.name ?? user.email ?? user.sub;
      for (const mentionedUserId of mentionedIds) {
        await notificationService.createNotification({
          recipientId: mentionedUserId,
          type: "mention",
          actorId: user.sub,
          actorName: displayName,
          taskId: input.taskId,
          taskTitle,
          commentId: entity.id,
          message: `${displayName} mentioned you in a comment on "${taskTitle}"`,
        });
      }
    }

    return entity;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      id: t.string().required(),
      content: t.string().required(),
      mentionedUserIds: t.list(t.string()),
    },
    output: commentArcheType,
  })
  async updateComment(
    input: { id: string; content: string; mentionedUserIds?: string[] },
    context: AuthContext,
  ) {
    const user = requirePermission(context, TasksResources.Tasks, Action.Update);

    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Comment not found");

    const info = await entity.get(CommentInfo);
    if (info?.authorId !== user.sub) {
      throw new Error("Not authorized to edit this comment");
    }

    const newMentionedIds = input.mentionedUserIds ?? [];
    const oldMentionedIds: string[] = (() => {
      try {
        return JSON.parse(info.mentionedUserIds || "[]");
      } catch {
        return [];
      }
    })();

    await entity.set(CommentInfo, {
      content: input.content,
      updatedAt: new Date().toISOString(),
      mentionedUserIds: JSON.stringify(newMentionedIds),
    });
    await entity.save();

    // Only notify newly added mentions
    const newlyMentioned = newMentionedIds.filter(
      (id) => !oldMentionedIds.includes(id),
    );
    if (newlyMentioned.length > 0) {
      const taskId = info.taskId;
      const taskEntity = await new Query().findOneById(taskId);
      const taskInfo = taskEntity ? await taskEntity.get(TaskInfo) : null;
      const taskTitle = taskInfo?.title ?? "a task";

      const notificationService = NotificationService.getInstance();
      const displayName = user.name ?? user.email ?? user.sub;
      for (const mentionedUserId of newlyMentioned) {
        await notificationService.createNotification({
          recipientId: mentionedUserId,
          type: "mention",
          actorId: user.sub,
          actorName: displayName,
          taskId,
          taskTitle,
          commentId: entity.id,
          message: `${displayName} mentioned you in a comment on "${taskTitle}"`,
        });
      }
    }

    return entity;
  }

  @GraphQLOperation({
    type: "Query",
    input: {
      taskIds: t.list(t.string()).required(),
    },
    output: "JSON",
  })
  async commentCounts(input: { taskIds: string[] }, context: AuthContext) {
    requirePermission(context, TasksResources.Tasks, Action.Read);
    const counts: Record<string, number> = {};
    for (const taskId of input.taskIds) {
      counts[taskId] = 0;
    }

    if (input.taskIds.length === 0) return counts;

    // Batch query: fetch all comments for all taskIds in one query
    const entities = await new Query()
      .with(CommentInfo, {
        filters: [
          Query.filter("taskId", Query.filterOp.IN, input.taskIds),
        ],
      })
      .populate()
      .exec();

    // Group counts by taskId
    for (const entity of entities) {
      const info = entity.getInMemory(CommentInfo);
      if (info?.taskId && counts[info.taskId] !== undefined) {
        counts[info.taskId]++;
      }
    }
    return counts;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      id: t.string().required(),
    },
    output: "Boolean",
  })
  async deleteComment(
    input: { id: string },
    context: AuthContext,
  ) {
    const user = requirePermission(context, TasksResources.Tasks, Action.Delete);

    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Comment not found");

    const info = await entity.get(CommentInfo);
    if (info?.authorId !== user.sub) {
      throw new Error("Not authorized to delete this comment");
    }

    await entity.delete();
    return true;
  }
}
