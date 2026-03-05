import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import { t } from "bunsane/gql/schema";
import { Query } from "bunsane/query";
import { ActivityInfo } from "../components/ActivityInfo";
import { ActivityArcheType } from "../archetypes/ActivityArcheType";
import { requirePermission, type AuthContext, TaskResources, Action } from "~/utils/auth";

const activityArcheType = new ActivityArcheType();

export default class ActivityService extends BaseService {
  private static instance: ActivityService;

  constructor() {
    super();
    activityArcheType.registerFieldResolvers(this);
    ActivityService.instance = this;
  }

  static getInstance(): ActivityService {
    return ActivityService.instance;
  }

  /**
   * Internal helper — called by other services to record activity.
   */
  async recordActivity(params: {
    taskId: string;
    actorId: string;
    actorName: string;
    action: "created" | "updated" | "deleted";
    changes: Array<{ field: string; from: string; to: string }>;
    taskTitle?: string;
  }): Promise<void> {
    const archetype = new ActivityArcheType();
    archetype.fill({
      activityInfo: {
        taskId: params.taskId,
        actorId: params.actorId,
        actorName: params.actorName,
        action: params.action,
        taskTitle: params.taskTitle ?? "",
        changes: JSON.stringify(params.changes),
        createdAt: new Date().toISOString(),
      },
    });

    await archetype.createAndSaveEntity();
  }

  @GraphQLOperation({
    type: "Query",
    input: {
      limit: t.int(),
    },
    output: [activityArcheType],
  })
  async listRecentActivities(input: { limit?: number }, context: AuthContext) {
    requirePermission(context, TaskResources.Tasks, Action.Read);
    const take = input.limit ?? 20;
    const entities = await new Query()
      .with(ActivityInfo)
      .sortBy(ActivityInfo, "createdAt", "DESC")
      .take(take)
      .populate()
      .exec();
    return entities;
  }

  @GraphQLOperation({
    type: "Query",
    input: {
      taskId: t.string().required(),
    },
    output: [activityArcheType],
  })
  async listActivities(input: { taskId: string }, context: AuthContext) {
    requirePermission(context, TaskResources.Tasks, Action.Read);
    const entities = await new Query()
      .with(ActivityInfo, {
        filters: [
          Query.typedFilter(ActivityInfo, "taskId", "=", input.taskId),
        ],
      })
      .sortBy(ActivityInfo, "createdAt", "ASC")
      .populate()
      .exec();
    return entities;
  }
}
