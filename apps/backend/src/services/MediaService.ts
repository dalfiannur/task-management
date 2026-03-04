import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import { t } from "bunsane/gql/schema";
import { Query } from "bunsane/query";
import { TaskMediaLinkTag, TaskMediaLinkData } from "../components/TaskMediaLink";
import { TaskMediaLinkArcheType } from "../archetypes/TaskMediaLinkArcheType";
import { requirePermission, type AuthContext } from "~/utils/auth";
import { TaskResources, Action } from "@qyubit/sedjiwa-permissions";

const taskMediaLinkArcheType = new TaskMediaLinkArcheType();

export default class MediaService extends BaseService {
  constructor() {
    super();
    taskMediaLinkArcheType.registerFieldResolvers(this);
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      mediaFileId: t.string().required(),
      taskId: t.string().required(),
      projectId: t.string().required(),
    },
    output: taskMediaLinkArcheType,
  })
  async linkMediaFile(input: {
    mediaFileId: string;
    taskId: string;
    projectId: string;
  }, context: AuthContext) {
    requirePermission(context, TaskResources.Tasks, Action.Update);
    // Check for existing link to avoid duplicates
    const existing = await new Query()
      .with(TaskMediaLinkTag)
      .with(TaskMediaLinkData, {
        filters: [
          Query.typedFilter(TaskMediaLinkData, "mediaFileId", "=", input.mediaFileId),
          Query.typedFilter(TaskMediaLinkData, "taskId", "=", input.taskId),
        ],
      })
      .exec();

    if (existing.length > 0) {
      return existing[0];
    }

    const archetype = new TaskMediaLinkArcheType();
    archetype.fill({
      taskMediaLinkData: {
        mediaFileId: input.mediaFileId,
        taskId: input.taskId,
        projectId: input.projectId,
      },
    });
    return await archetype.createAndSaveEntity();
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      mediaFileId: t.string().required(),
      taskId: t.string().required(),
    },
    output: "Boolean",
  })
  async unlinkMediaFile(input: { mediaFileId: string; taskId: string }, context: AuthContext) {
    requirePermission(context, TaskResources.Tasks, Action.Update);
    const links = await new Query()
      .with(TaskMediaLinkTag)
      .with(TaskMediaLinkData, {
        filters: [
          Query.typedFilter(TaskMediaLinkData, "mediaFileId", "=", input.mediaFileId),
          Query.typedFilter(TaskMediaLinkData, "taskId", "=", input.taskId),
        ],
      })
      .exec();

    for (const link of links) {
      await link.delete();
    }
    return true;
  }

  @GraphQLOperation({
    type: "Query",
    input: {
      taskId: t.string().required(),
    },
    output: [taskMediaLinkArcheType],
  })
  async listTaskMediaLinks(input: { taskId: string }, context: AuthContext) {
    requirePermission(context, TaskResources.Tasks, Action.Read);
    return await new Query()
      .with(TaskMediaLinkTag)
      .with(TaskMediaLinkData, {
        filters: [
          Query.typedFilter(TaskMediaLinkData, "taskId", "=", input.taskId),
        ],
      })
      .populate()
      .exec();
  }

  @GraphQLOperation({
    type: "Query",
    input: {
      projectId: t.string().required(),
    },
    output: [taskMediaLinkArcheType],
  })
  async listProjectMediaLinks(input: { projectId: string }, context: AuthContext) {
    requirePermission(context, TaskResources.Tasks, Action.Read);
    return await new Query()
      .with(TaskMediaLinkTag)
      .with(TaskMediaLinkData, {
        filters: [
          Query.typedFilter(TaskMediaLinkData, "projectId", "=", input.projectId),
        ],
      })
      .populate()
      .exec();
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      mediaFileId: t.string().required(),
    },
    output: "Boolean",
  })
  async unlinkAllForMediaFile(input: { mediaFileId: string }, context: AuthContext) {
    requirePermission(context, TaskResources.Tasks, Action.Delete);
    const links = await new Query()
      .with(TaskMediaLinkTag)
      .with(TaskMediaLinkData, {
        filters: [
          Query.typedFilter(TaskMediaLinkData, "mediaFileId", "=", input.mediaFileId),
        ],
      })
      .exec();

    for (const link of links) {
      await link.delete();
    }
    return true;
  }
}
