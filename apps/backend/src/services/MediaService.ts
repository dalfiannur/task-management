import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import { Query } from "bunsane/query";
import { z } from "zod";
import { TaskMediaLinkTag, TaskMediaLinkData } from "../components/TaskMediaLink";
import { TaskMediaLinkArcheType } from "../archetypes/TaskMediaLinkArcheType";

const taskMediaLinkArcheType = new TaskMediaLinkArcheType();

export default class MediaService extends BaseService {
  constructor() {
    super();
    taskMediaLinkArcheType.registerFieldResolvers(this);
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      mediaFileId: z.string(),
      taskId: z.string(),
      projectId: z.string(),
    }),
    output: taskMediaLinkArcheType,
  })
  async linkMediaFile(input: {
    mediaFileId: string;
    taskId: string;
    projectId: string;
  }) {
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
    input: z.object({
      mediaFileId: z.string(),
      taskId: z.string(),
    }),
    output: "Boolean",
  })
  async unlinkMediaFile(input: { mediaFileId: string; taskId: string }) {
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
    input: z.object({
      taskId: z.string(),
    }),
    output: [taskMediaLinkArcheType],
  })
  async listTaskMediaLinks(input: { taskId: string }) {
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
    input: z.object({
      projectId: z.string(),
    }),
    output: [taskMediaLinkArcheType],
  })
  async listProjectMediaLinks(input: { projectId: string }) {
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
    input: z.object({
      mediaFileId: z.string(),
    }),
    output: "Boolean",
  })
  async unlinkAllForMediaFile(input: { mediaFileId: string }) {
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
