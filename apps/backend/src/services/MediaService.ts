import { BaseService, Options, Post } from "bunsane/service";
import { GraphQLOperation } from 'bunsane/gql';
import { Entity } from 'bunsane/core/Entity';
import { Query } from 'bunsane/query';
import { UploadManager } from "bunsane/upload";
import { z } from "zod";
import { MediaFileInfo } from "../components/MediaFileInfo";
import { MediaFileArcheType } from "../archetypes/MediaFileArcheType";
import { AuthPlugin } from "../plugins/AuthPlugin";
import { ApiTags } from "bunsane/swagger";

const mediaFileArcheType = new MediaFileArcheType();

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonWithCors(body: unknown, init?: ResponseInit): Response {
  const res = Response.json(body, init);
  for (const [k, v] of Object.entries(corsHeaders)) {
    res.headers.set(k, v);
  }
  return res;
}

@ApiTags("Media")
export default class MediaService extends BaseService {
  constructor() {
    super();
    mediaFileArcheType.registerFieldResolvers(this);
  }

  @Options("/api/media/upload")
  async uploadPreflight(_req: Request): Promise<Response> {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  @Post("/api/media/upload")
  async uploadFile(req: Request): Promise<Response> {
    try {
      const user = await AuthPlugin.extractUser(req);
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const projectId = formData.get("projectId") as string | null;
      const taskId = (formData.get("taskId") as string) ?? "";

      if (!file || !projectId) {
        return jsonWithCors(
          { error: "file and projectId are required" },
          { status: 400 },
        );
      }

      const uploadManager = UploadManager.getInstance();
      const result = await uploadManager.uploadFile(file, {
        uploadPath: `projects/${projectId}`,
      });

      if (!result.success) {
        return jsonWithCors(
          { error: result.error?.message ?? "Upload failed" },
          { status: 400 },
        );
      }

      const archetype = new MediaFileArcheType();
      archetype.fill({
        mediaFileInfo: {
          fileName: result.fileName ?? file.name,
          originalFileName: result.originalFileName ?? file.name,
          mimeType: result.mimeType ?? file.type,
          size: result.size ?? file.size,
          storageKey: result.path ?? "",
          url: result.url ?? "",
          projectId,
          taskId,
          uploadedBy: user?.id ?? "",
        },
      });

      const entity = await archetype.createAndSaveEntity();

      return jsonWithCors({
        id: entity.id,
        mediaFileInfo: {
          fileName: result.fileName ?? file.name,
          originalFileName: result.originalFileName ?? file.name,
          mimeType: result.mimeType ?? file.type,
          size: result.size ?? file.size,
          storageKey: result.path ?? "",
          url: result.url ?? "",
          projectId,
          taskId,
          uploadedBy: user?.id ?? "",
        },
      }, { status: 201 });
    } catch (err: any) {
      return jsonWithCors(
        { error: err.message ?? "Upload failed" },
        { status: 500 },
      );
    }
  }

  @GraphQLOperation({
    type: "Query",
    input: z.object({
      projectId: z.string(),
      taskId: z.string().optional(),
      mimeType: z.string().optional(),
      page: z.number().optional(),
      pageSize: z.number().optional(),
    }),
    output: [mediaFileArcheType],
  })
  async listMediaFiles(
    input: {
      projectId: string;
      taskId?: string;
      mimeType?: string;
      page?: number;
      pageSize?: number;
    },
    _context: unknown,
  ) {
    const query = new Query().with(MediaFileInfo, {
      filters: [
        Query.typedFilter(MediaFileInfo, "projectId", "=", input.projectId),
      ],
    });

    if (input.taskId) {
      query.with(MediaFileInfo, {
        filters: [
          Query.typedFilter(MediaFileInfo, "taskId", "=", input.taskId),
        ],
      });
    }

    if (input.mimeType) {
      query.with(MediaFileInfo, {
        filters: [
          Query.typedFilter(
            MediaFileInfo,
            "mimeType",
            "LIKE",
            `${input.mimeType}%`,
          ),
        ],
      });
    }

    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 50;
    query.take(pageSize).offset((page - 1) * pageSize);

    return await query.populate().exec();
  }

  @GraphQLOperation({
    type: "Query",
    input: z.object({
      id: z.string(),
    }),
    output: mediaFileArcheType,
  })
  async getMediaFile(input: { id: string }) {
    return await Entity.FindById(input.id);
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      id: z.string(),
      taskId: z.string().optional(),
    }),
    output: mediaFileArcheType,
  })
  async updateMediaFile(input: { id: string; taskId?: string }) {
    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Media file not found");

    if (input.taskId !== undefined) {
      await entity.set(MediaFileInfo, { taskId: input.taskId });
    }

    await entity.save();
    return entity;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      id: z.string(),
    }),
    output: "Boolean",
  })
  async deleteMediaFile(input: { id: string }) {
    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Media file not found");

    const mediaInfo = await entity.get(MediaFileInfo);
    const storageKey = mediaInfo?.storageKey;

    if (storageKey) {
      try {
        const uploadManager = UploadManager.getInstance();
        await uploadManager.deleteFile(storageKey);
      } catch {
        // Storage deletion failed, still delete entity
      }
    }

    await entity.delete();
    return true;
  }
}
