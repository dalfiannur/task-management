import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import { t } from "bunsane/gql/schema";
import { Query } from "bunsane/query";
import { TaskMediaLinkTag, TaskMediaLinkData } from "../components/TaskMediaLink";
import { TaskMediaLinkArcheType } from "../archetypes/TaskMediaLinkArcheType";
import { MediaFileInfo } from "../components/MediaFileInfo";
import { MediaFileArcheType } from "../archetypes/MediaFileArcheType";
import { ProjectTag, ProjectParentRefComponent } from "../components/ProjectComponents";
import { resolveLocalProjectId } from "~/lib/resolve-project-id";
import { requirePermission, type AuthContext, TaskResources, Action } from "~/utils/auth";

const taskMediaLinkArcheType = new TaskMediaLinkArcheType();
const mediaFileArcheType = new MediaFileArcheType();

export default class MediaService extends BaseService {
  constructor() {
    super();
    taskMediaLinkArcheType.registerFieldResolvers(this);
    mediaFileArcheType.registerFieldResolvers(this);
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

    const localProjectId = await resolveLocalProjectId(input.projectId);
    const archetype = new TaskMediaLinkArcheType();
    archetype.fill({
      taskMediaLinkData: {
        mediaFileId: input.mediaFileId,
        taskId: input.taskId,
        projectId: localProjectId,
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
    const localProjectId = await resolveLocalProjectId(input.projectId);
    return await new Query()
      .with(TaskMediaLinkTag)
      .with(TaskMediaLinkData, {
        filters: [
          Query.typedFilter(TaskMediaLinkData, "projectId", "=", localProjectId),
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

  @GraphQLOperation({
    type: "Mutation",
    input: {
      mediaFileId: t.string().required(),
      projectId: t.string().required(),
      visibility: t.string().required(),
      originalFileName: t.string(),
      mimeType: t.string(),
      size: t.int(),
      url: t.string(),
    },
    output: mediaFileArcheType,
  })
  async setMediaFileVisibility(
    input: {
      mediaFileId: string;
      projectId: string;
      visibility: string;
      originalFileName?: string;
      mimeType?: string;
      size?: number;
      url?: string;
    },
    context: AuthContext,
  ) {
    requirePermission(context, TaskResources.Tasks, Action.Update);
    const localProjectId = await resolveLocalProjectId(input.projectId);

    // Find existing MediaFileInfo entity for this file
    const existing = await new Query()
      .with(MediaFileInfo, {
        filters: [
          Query.typedFilter(MediaFileInfo, "fileName", "=", input.mediaFileId),
          Query.typedFilter(MediaFileInfo, "projectId", "=", localProjectId),
        ],
      })
      .populate()
      .exec();

    if (existing.length > 0) {
      const entity = existing[0];
      const updateData: Record<string, unknown> = {
        visibility: input.visibility,
      };
      if (input.originalFileName) updateData.originalFileName = input.originalFileName;
      if (input.mimeType) updateData.mimeType = input.mimeType;
      if (input.size !== undefined) updateData.size = input.size;
      if (input.url) updateData.url = input.url;
      await entity.set(MediaFileInfo, updateData);
      await entity.save();
      return entity;
    }

    // Create a new MediaFileInfo entity to track visibility + file metadata
    const archetype = new MediaFileArcheType();
    archetype.fill({
      mediaFileInfo: {
        fileName: input.mediaFileId,
        projectId: localProjectId,
        visibility: input.visibility,
        originalFileName: input.originalFileName ?? "",
        mimeType: input.mimeType ?? "",
        size: input.size ?? 0,
        url: input.url ?? "",
      },
    });
    return await archetype.createAndSaveEntity();
  }

  @GraphQLOperation({
    type: "Query",
    input: {
      projectId: t.string().required(),
    },
    output: [mediaFileArcheType],
  })
  async listSharedMediaFiles(input: { projectId: string }, context: AuthContext) {
    requirePermission(context, TaskResources.Tasks, Action.Read);
    const localProjectId = await resolveLocalProjectId(input.projectId);

    // Get all project IDs in the hierarchy, excluding the requesting project
    const hierarchyIds = await this.getProjectHierarchyIds(localProjectId);
    const otherProjectIds = hierarchyIds.filter((id) => id !== localProjectId);

    if (otherProjectIds.length === 0) return [];

    // Query shared files from all other projects in the hierarchy
    const results = [];
    for (const pid of otherProjectIds) {
      const files = await new Query()
        .with(MediaFileInfo, {
          filters: [
            Query.typedFilter(MediaFileInfo, "projectId", "=", pid),
            Query.typedFilter(MediaFileInfo, "visibility", "=", "shared"),
          ],
        })
        .populate()
        .exec();
      results.push(...files);
    }
    return results;
  }

  /** Resolve a project to its full hierarchy (parent + all sub-projects). */
  private async getProjectHierarchyIds(localProjectId: string): Promise<string[]> {
    const ids: string[] = [localProjectId];

    // Check if this project is a sub-project (has a parent)
    // Query for this specific project's parent ref
    const parentRefs = await new Query()
      .with(ProjectTag)
      .with(ProjectParentRefComponent, {
        filters: [
          Query.typedFilter(ProjectParentRefComponent, "parentProjectId", "=", localProjectId),
        ],
      })
      .exec();

    // Check: is localProjectId itself a child? Query entities where this project's ID matches
    // We need to find our project entity and check its ProjectParentRefComponent
    const allSubProjects = await new Query()
      .with(ProjectTag)
      .with(ProjectParentRefComponent)
      .populate()
      .exec();

    let parentId: string | null = null;
    for (const entity of allSubProjects) {
      if (entity.id === localProjectId) {
        const ref = await entity.get(ProjectParentRefComponent);
        if (ref?.parentProjectId) {
          parentId = ref.parentProjectId;
        }
      }
    }

    // Determine root project
    const rootId = parentId ?? localProjectId;
    if (parentId) ids.push(parentId);

    // Find all sub-projects of the root
    for (const entity of allSubProjects) {
      const ref = await entity.get(ProjectParentRefComponent);
      if (ref?.parentProjectId === rootId && !ids.includes(entity.id)) {
        ids.push(entity.id);
      }
    }

    return ids;
  }
}
