import { BaseService } from "bunsane/service";
import { GraphQLOperation } from 'bunsane/gql';
import { Entity } from 'bunsane/core/Entity';
import { Query } from 'bunsane/query';
import { z } from "zod";
import { TaskInfo } from "../components/TaskInfo";
import { TaskAssignment } from "../components/TaskAssignment";
import { TaskLabels } from "../components/TaskLabels";
import { TaskArcheType } from "../archetypes/TaskArcheType";
import { AuthPlugin } from "../plugins/AuthPlugin";
import NotificationService from "./NotificationService";
import ActivityService from "./ActivityService";
import MembershipService from "./MembershipService";
import { ModuleProjectRefComponent } from "../components/ModuleComponents";

function encodeLabelIds(ids?: string[]): string {
  return JSON.stringify(ids ?? []);
}

function encodeAssigneeIds(ids?: string[]): string {
  return JSON.stringify(ids ?? []);
}

const taskArcheType = new TaskArcheType();

export default class TaskService extends BaseService {
  constructor() {
    super();
    taskArcheType.registerFieldResolvers(this);
  }

  @GraphQLOperation({
    type: "Query",
    input: z.object({
      moduleId: z.string(),
      status: z.string().optional(),
      priority: z.string().optional(),
      assigneeId: z.string().optional(),
      search: z.string().optional(),
      sort: z.string().optional(),
      page: z.number().optional(),
      pageSize: z.number().optional(),
    }),
    output: [taskArcheType],
  })
  async listTasks(
    input: {
      moduleId: string;
      status?: string;
      priority?: string;
      assigneeId?: string;
      search?: string;
      sort?: string;
      page?: number;
      pageSize?: number;
    },
    _context: unknown,
  ) {
    const query = new Query()
      .with(TaskAssignment, {
        filters: [
          Query.typedFilter(TaskAssignment, "moduleId", "=", input.moduleId),
        ],
      })
      .with(TaskInfo)
      .with(TaskLabels);

    if (input.status) {
      query.with(TaskInfo, {
        filters: [Query.typedFilter(TaskInfo, "status", "=", input.status)],
      });
    }

    if (input.priority) {
      query.with(TaskInfo, {
        filters: [
          Query.typedFilter(TaskInfo, "priority", "=", input.priority),
        ],
      });
    }

    if (input.assigneeId) {
      query.with(TaskAssignment, {
        filters: [
          Query.typedFilter(
            TaskAssignment,
            "assigneeIds",
            "LIKE",
            `%"${input.assigneeId}"%`,
          ),
        ],
      });
    }

    if (input.search) {
      query.with(TaskInfo, {
        filters: [
          Query.typedFilter(TaskInfo, "title", "LIKE", `%${input.search}%`),
        ],
      });
    }

    query.sortBy(TaskInfo, "order", "ASC");

    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 50;
    query.take(pageSize).offset((page - 1) * pageSize);

    const entities = await query.populate().exec();
    return entities;
  }

  @GraphQLOperation({
    type: "Query",
    input: z.object({
      projectId: z.string().optional(),
      status: z.string().optional(),
      priority: z.string().optional(),
      assigneeId: z.string().optional(),
      page: z.number().optional(),
      pageSize: z.number().optional(),
    }),
    output: [taskArcheType],
  })
  async listAllTasks(
    input: {
      projectId?: string;
      status?: string;
      priority?: string;
      assigneeId?: string;
      page?: number;
      pageSize?: number;
    },
    _context: unknown,
  ) {
    const query = new Query().with(TaskInfo).with(TaskAssignment).with(TaskLabels);

    if (input.status) {
      query.with(TaskInfo, {
        filters: [Query.typedFilter(TaskInfo, "status", "=", input.status)],
      });
    }

    if (input.priority) {
      query.with(TaskInfo, {
        filters: [
          Query.typedFilter(TaskInfo, "priority", "=", input.priority),
        ],
      });
    }

    if (input.assigneeId) {
      query.with(TaskAssignment, {
        filters: [
          Query.typedFilter(
            TaskAssignment,
            "assigneeIds",
            "LIKE",
            `%"${input.assigneeId}"%`,
          ),
        ],
      });
    }

    query.sortBy(TaskInfo, "order", "ASC");

    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 200;
    query.take(pageSize).offset((page - 1) * pageSize);

    const entities = await query.populate().exec();
    return entities;
  }

  @GraphQLOperation({
    type: "Query",
    input: z.object({
      id: z.string(),
    }),
    output: taskArcheType,
  })
  async getTask(input: { id: string }) {
    return await Entity.FindById(input.id);
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      title: z.string(),
      description: z.string().optional(),
      status: z.string().optional(),
      priority: z.string().optional(),
      startDate: z.string().optional(),
      dueDate: z.string().optional(),
      assigneeIds: z.array(z.string()).optional(),
      moduleId: z.string(),
      labelIds: z.array(z.string()).optional(),
    }),
    output: taskArcheType,
  })
  async createTask(
    input: {
      title: string;
      description?: string;
      status?: string;
      priority?: string;
      startDate?: string;
      dueDate?: string;
      assigneeIds?: string[];
      moduleId: string;
      labelIds?: string[];
    },
    context: { request?: Request },
  ) {
    const archetype = new TaskArcheType();
    const now = new Date().toISOString();
    archetype.fill({
      taskInfo: {
        title: input.title,
        description: input.description ?? "",
        status: input.status ?? "todo",
        priority: input.priority ?? "none",
        startDate: input.startDate ?? "",
        dueDate: input.dueDate ?? "",
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
      taskAssignment: {
        assigneeIds: encodeAssigneeIds(input.assigneeIds),
        moduleId: input.moduleId,
      },
      taskLabels: {
        labelIds: encodeLabelIds(input.labelIds),
      },
    });

    const entity = await archetype.createAndSaveEntity();

    // Auto-add assignees as project members
    if (input.assigneeIds?.length) {
      const moduleEntity = await new Query().findOneById(input.moduleId);
      const moduleRef = moduleEntity ? await moduleEntity.get(ModuleProjectRefComponent) : null;
      if (moduleRef?.projectId) {
        for (const assigneeId of input.assigneeIds) {
          await MembershipService.getInstance().ensureMembership(moduleRef.projectId, assigneeId);
        }
      }
    }

    // Record activity
    if (context?.request) {
      const user = await AuthPlugin.extractUser(context.request);
      if (user) {
        await ActivityService.getInstance().recordActivity({
          taskId: entity.id,
          actorId: user.id,
          actorName: user.name,
          action: "created",
          changes: [],
          taskTitle: input.title,
        });
      }
    }

    return entity;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      status: z.string().optional(),
      priority: z.string().optional(),
      startDate: z.string().optional(),
      dueDate: z.string().optional(),
      assigneeIds: z.array(z.string()).optional(),
      labelIds: z.array(z.string()).optional(),
    }),
    output: taskArcheType,
  })
  async updateTask(
    input: {
      id: string;
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
      startDate?: string;
      dueDate?: string;
      assigneeIds?: string[];
      labelIds?: string[];
    },
    context: { request?: Request },
  ) {
    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Task not found");

    // Capture old values for activity tracking and notification diffing
    const oldTaskInfo = await entity.get(TaskInfo);
    const oldAssignment = await entity.get(TaskAssignment);
    const oldLabels = await entity.get(TaskLabels);

    let oldAssigneeIds: string[] = [];
    if (input.assigneeIds !== undefined) {
      try {
        oldAssigneeIds = JSON.parse(oldAssignment?.assigneeIds || "[]");
      } catch {
        oldAssigneeIds = [];
      }
    }

    let oldLabelIds: string[] = [];
    if (input.labelIds !== undefined) {
      try {
        oldLabelIds = JSON.parse(oldLabels?.labelIds || "[]");
      } catch {
        oldLabelIds = [];
      }
    }

    const taskInfoUpdates: Record<string, unknown> = {};
    if (input.title !== undefined) taskInfoUpdates.title = input.title;
    if (input.description !== undefined)
      taskInfoUpdates.description = input.description;
    if (input.status !== undefined) taskInfoUpdates.status = input.status;
    if (input.priority !== undefined) taskInfoUpdates.priority = input.priority;
    if (input.startDate !== undefined) taskInfoUpdates.startDate = input.startDate;
    if (input.dueDate !== undefined) taskInfoUpdates.dueDate = input.dueDate;
    taskInfoUpdates.updatedAt = new Date().toISOString();

    await entity.set(TaskInfo, taskInfoUpdates);

    if (input.assigneeIds !== undefined) {
      await entity.set(TaskAssignment, { assigneeIds: encodeAssigneeIds(input.assigneeIds) });
    }

    if (input.labelIds !== undefined) {
      await entity.set(TaskLabels, { labelIds: encodeLabelIds(input.labelIds) });
    }

    await entity.save();

    // Extract user for notifications and activity
    let actorId = "";
    let actorName = "Someone";
    if (context?.request) {
      const user = await AuthPlugin.extractUser(context.request);
      if (user) {
        actorId = user.id;
        actorName = user.name;
      }
    }

    // Build activity changes
    const changes: Array<{ field: string; from: string; to: string }> = [];

    if (input.title !== undefined && input.title !== oldTaskInfo?.title) {
      changes.push({ field: "title", from: oldTaskInfo?.title ?? "", to: input.title });
    }
    if (input.description !== undefined && input.description !== oldTaskInfo?.description) {
      changes.push({ field: "description", from: "(previous)", to: "(updated)" });
    }
    if (input.status !== undefined && input.status !== oldTaskInfo?.status) {
      changes.push({ field: "status", from: oldTaskInfo?.status ?? "", to: input.status });
    }
    if (input.priority !== undefined && input.priority !== oldTaskInfo?.priority) {
      changes.push({ field: "priority", from: oldTaskInfo?.priority ?? "", to: input.priority });
    }
    if (input.startDate !== undefined && input.startDate !== oldTaskInfo?.startDate) {
      changes.push({ field: "startDate", from: oldTaskInfo?.startDate ?? "", to: input.startDate });
    }
    if (input.dueDate !== undefined && input.dueDate !== oldTaskInfo?.dueDate) {
      changes.push({ field: "dueDate", from: oldTaskInfo?.dueDate ?? "", to: input.dueDate });
    }
    if (input.assigneeIds !== undefined) {
      const newEncoded = encodeAssigneeIds(input.assigneeIds);
      const oldEncoded = oldAssignment?.assigneeIds ?? "[]";
      if (newEncoded !== oldEncoded) {
        changes.push({ field: "assigneeIds", from: oldEncoded, to: newEncoded });
      }
    }
    if (input.labelIds !== undefined) {
      const newEncoded = encodeLabelIds(input.labelIds);
      const oldEncoded = oldLabels?.labelIds ?? "[]";
      if (newEncoded !== oldEncoded) {
        changes.push({ field: "labelIds", from: oldEncoded, to: newEncoded });
      }
    }

    // Record activity if there were changes
    if (changes.length > 0 && actorId) {
      await ActivityService.getInstance().recordActivity({
        taskId: input.id,
        actorId,
        actorName,
        action: "updated",
        changes,
        taskTitle: oldTaskInfo?.title ?? "",
      });
    }

    // Auto-add newly assigned users as project members
    if (input.assigneeIds !== undefined) {
      const newlyAssigned = input.assigneeIds.filter(
        (id) => !oldAssigneeIds.includes(id),
      );
      if (newlyAssigned.length > 0) {
        const assignment = await entity.get(TaskAssignment);
        if (assignment?.moduleId) {
          const moduleEntity = await new Query().findOneById(assignment.moduleId);
          const moduleRef = moduleEntity ? await moduleEntity.get(ModuleProjectRefComponent) : null;
          if (moduleRef?.projectId) {
            for (const assigneeId of newlyAssigned) {
              await MembershipService.getInstance().ensureMembership(moduleRef.projectId, assigneeId);
            }
          }
        }
      }
    }

    // Notify newly assigned users
    if (input.assigneeIds !== undefined) {
      const newlyAssigned = input.assigneeIds.filter(
        (id) => !oldAssigneeIds.includes(id),
      );
      if (newlyAssigned.length > 0) {
        const taskInfo = await entity.get(TaskInfo);
        const taskTitle = taskInfo?.title ?? "a task";

        const notificationService = NotificationService.getInstance();
        for (const assigneeId of newlyAssigned) {
          await notificationService.createNotification({
            recipientId: assigneeId,
            type: "task_assigned",
            actorId,
            actorName,
            taskId: input.id,
            taskTitle,
            message: `${actorName} assigned you to "${taskTitle}"`,
          });
        }
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
  async deleteTask(
    input: { id: string },
    context: { request?: Request },
  ) {
    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Task not found");

    // Capture title before deletion for activity record
    const taskInfo = await entity.get(TaskInfo);
    const taskTitle = taskInfo?.title ?? "";

    // Record activity before deleting
    if (context?.request) {
      const user = await AuthPlugin.extractUser(context.request);
      if (user) {
        await ActivityService.getInstance().recordActivity({
          taskId: input.id,
          actorId: user.id,
          actorName: user.name,
          action: "deleted",
          changes: [{ field: "title", from: taskTitle, to: "" }],
          taskTitle,
        });
      }
    }

    await entity.delete();
    return true;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      id: z.string(),
      newOrder: z.number(),
      newStatus: z.string().optional(),
    }),
    output: taskArcheType,
  })
  async reorderTask(input: {
    id: string;
    newOrder: number;
    newStatus?: string;
  }) {
    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Task not found");

    const updates: Record<string, unknown> = { order: input.newOrder };
    if (input.newStatus) updates.status = input.newStatus;

    await entity.set(TaskInfo, updates);
    await entity.save();
    return entity;
  }
}
