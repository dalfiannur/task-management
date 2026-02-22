import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import { Query } from "bunsane/query";
import { z } from "zod";
import { CommentInfo } from "../components/CommentInfo";
import { CommentArcheType } from "../archetypes/CommentArcheType";
import { TaskInfo } from "../components/TaskInfo";
import { AuthPlugin } from "../plugins/AuthPlugin";
import NotificationService from "./NotificationService";

const commentArcheType = new CommentArcheType();

async function requireUser(context: { request?: Request }) {
  if (!context.request) throw new Error("Authentication required");
  const user = await AuthPlugin.extractUser(context.request);
  if (!user) throw new Error("Authentication required");
  return user;
}

export default class CommentService extends BaseService {
  constructor() {
    super();
    commentArcheType.registerFieldResolvers(this);
  }

  @GraphQLOperation({
    type: "Query",
    input: z.object({
      taskId: z.string(),
    }),
    output: [commentArcheType],
  })
  async listComments(input: { taskId: string }) {
    const entities = await new Query()
      .with(CommentInfo, {
        filters: [
          Query.typedFilter(CommentInfo, "taskId", "=", input.taskId),
        ],
      })
      .populate()
      .exec();
    return entities;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      taskId: z.string(),
      content: z.string(),
      mentionedUserIds: z.array(z.string()).optional(),
    }),
    output: commentArcheType,
  })
  async createComment(
    input: { taskId: string; content: string; mentionedUserIds?: string[] },
    context: { request?: Request },
  ) {
    const user = await requireUser(context);
    const mentionedIds = input.mentionedUserIds ?? [];

    const now = new Date().toISOString();
    const archetype = new CommentArcheType();
    archetype.fill({
      commentInfo: {
        taskId: input.taskId,
        authorId: user.id,
        authorName: user.name,
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
      for (const mentionedUserId of mentionedIds) {
        await notificationService.createNotification({
          recipientId: mentionedUserId,
          type: "mention",
          actorId: user.id,
          actorName: user.name,
          taskId: input.taskId,
          taskTitle,
          commentId: entity.id,
          message: `${user.name} mentioned you in a comment on "${taskTitle}"`,
        });
      }
    }

    return entity;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      id: z.string(),
      content: z.string(),
      mentionedUserIds: z.array(z.string()).optional(),
    }),
    output: commentArcheType,
  })
  async updateComment(
    input: { id: string; content: string; mentionedUserIds?: string[] },
    context: { request?: Request },
  ) {
    const user = await requireUser(context);

    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Comment not found");

    const info = await entity.get(CommentInfo);
    if (info?.authorId !== user.id) {
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
      for (const mentionedUserId of newlyMentioned) {
        await notificationService.createNotification({
          recipientId: mentionedUserId,
          type: "mention",
          actorId: user.id,
          actorName: user.name,
          taskId,
          taskTitle,
          commentId: entity.id,
          message: `${user.name} mentioned you in a comment on "${taskTitle}"`,
        });
      }
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
  async deleteComment(
    input: { id: string },
    context: { request?: Request },
  ) {
    const user = await requireUser(context);

    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Comment not found");

    const info = await entity.get(CommentInfo);
    if (info?.authorId !== user.id) {
      throw new Error("Not authorized to delete this comment");
    }

    await entity.delete();
    return true;
  }
}
