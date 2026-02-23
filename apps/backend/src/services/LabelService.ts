import { BaseService } from "bunsane/service";
import { GraphQLOperation } from 'bunsane/gql';
import { Entity } from 'bunsane/core/Entity';
import { Query } from 'bunsane/query';
import { z } from "zod";
import { LabelInfo } from "../components/LabelInfo";
import { LabelArcheType } from "../archetypes/LabelArcheType";

const labelArcheType = new LabelArcheType();

export default class LabelService extends BaseService {
  @GraphQLOperation({
    type: "Query",
    input: z.object({
      projectId: z.string(),
    }),
    output: [labelArcheType],
  })
  async listLabels(input: { projectId: string }) {
    const entities = await new Query()
      .with(LabelInfo, {
        filters: [
          Query.typedFilter(LabelInfo, "projectId", "=", input.projectId),
        ],
      })
      .populate()
      .exec();

    return await Promise.all(
      entities.map(async (e: Entity) => {
        const info = await e.get(LabelInfo);
        return { id: e.id, labelInfo: info ? { name: info.name, color: info.color, projectId: info.projectId } : null };
      }),
    );
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      name: z.string(),
      color: z.string(),
      projectId: z.string(),
    }),
    output: labelArcheType,
  })
  async createLabel(input: {
    name: string;
    color: string;
    projectId: string;
  }) {
    const archetype = new LabelArcheType();
    archetype.fill({
      labelInfo: {
        name: input.name,
        color: input.color,
        projectId: input.projectId,
      },
    });
    const entity = await archetype.createAndSaveEntity();
    const saved = await Entity.FindById(entity.id);
    if (!saved) throw new Error("Failed to create label");
    const info = await saved.get(LabelInfo);
    return { id: saved.id, labelInfo: info ? { name: info.name, color: info.color, projectId: info.projectId } : null };
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      id: z.string(),
      name: z.string().optional(),
      color: z.string().optional(),
    }),
    output: labelArcheType,
  })
  async updateLabel(input: { id: string; name?: string; color?: string }) {
    const entity = await Entity.FindById(input.id);
    if (!entity) throw new Error("Label not found");

    const updates: Record<string, unknown> = {};
    if (input.name !== undefined) updates.name = input.name;
    if (input.color !== undefined) updates.color = input.color;

    if (Object.keys(updates).length > 0) {
      await entity.set(LabelInfo, updates);
      await entity.save();
    }

    const refreshed = await Entity.FindById(input.id);
    if (!refreshed) throw new Error("Label not found after update");
    const info = await refreshed.get(LabelInfo);
    return { id: refreshed.id, labelInfo: info ? { name: info.name, color: info.color, projectId: info.projectId } : null };
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      id: z.string(),
    }),
    output: "Boolean",
  })
  async deleteLabel(input: { id: string }) {
    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Label not found");
    await entity.delete();
    return true;
  }
}
