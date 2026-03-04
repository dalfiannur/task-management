import { BaseService } from "bunsane/service";
import { GraphQLOperation } from 'bunsane/gql';
import { t } from 'bunsane/gql/schema';
import { Entity } from 'bunsane/core/Entity';
import { Query } from 'bunsane/query';
import { LabelInfo } from "../components/LabelInfo";
import { LabelArcheType } from "../archetypes/LabelArcheType";
import { requirePermission, type AuthContext } from "~/utils/auth";
import { TaskResources, Action } from "@qyubit/sedjiwa-permissions";

const labelArcheType = new LabelArcheType();

export default class LabelService extends BaseService {
  constructor() {
    super();
    labelArcheType.registerFieldResolvers(this);
  }

  @GraphQLOperation({
    type: "Query",
    input: {
      projectId: t.string().required(),
    },
    output: [labelArcheType],
  })
  async listLabels(input: { projectId: string }, context: AuthContext) {
    requirePermission(context, TaskResources.Tasks, Action.Read);
    const entities = await new Query()
      .with(LabelInfo, {
        filters: [
          Query.typedFilter(LabelInfo, "projectId", "=", input.projectId),
        ],
      })
      .populate()
      .exec();

    // Components already cached after populate - use getInMemory
    return entities.map((e: Entity) => {
      const info = e.getInMemory(LabelInfo);
      return { id: e.id, labelInfo: info ? { name: info.name, color: info.color, projectId: info.projectId } : null };
    });
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      name: t.string().required(),
      color: t.string().required(),
      projectId: t.string().required(),
    },
    output: labelArcheType,
  })
  async createLabel(input: {
    name: string;
    color: string;
    projectId: string;
  }, context: AuthContext) {
    requirePermission(context, TaskResources.Tasks, Action.Create);
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
    input: {
      id: t.string().required(),
      name: t.string(),
      color: t.string(),
    },
    output: labelArcheType,
  })
  async updateLabel(input: { id: string; name?: string; color?: string }, context: AuthContext) {
    requirePermission(context, TaskResources.Tasks, Action.Update);
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
    input: {
      id: t.string().required(),
    },
    output: "Boolean",
  })
  async deleteLabel(input: { id: string }, context: AuthContext) {
    requirePermission(context, TaskResources.Tasks, Action.Delete);
    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Label not found");
    await entity.delete();
    return true;
  }
}
