import { BaseService } from "bunsane/service";
import { GraphQLOperation } from 'bunsane/gql';
import { Entity } from 'bunsane/core/Entity';
import { Query } from 'bunsane/query';
import { z } from "zod";
import { ModuleDescriptionComponent, ModuleNameComponent, ModuleProjectRefComponent, ModuleTag } from "../components/ModuleComponents";
import { ModuleArcheType } from "../archetypes/ModuleArcheType";

export default class ModuleService extends BaseService {
  constructor() {
    super();
    ModuleArcheType.registerFieldResolvers(this);
  }

  @GraphQLOperation({
    type: "Query",
    input: z.object({
      projectId: z.string(),
    }),
    output: [ModuleArcheType],
  })
  async listModules(input: { projectId: string }) {
    const query = new Query()
      .with(ModuleTag)
      .with(ModuleNameComponent)
      .with(ModuleDescriptionComponent)
      .with(ModuleProjectRefComponent, {
        filters: [
          Query.filter("projectId", Query.filterOp.EQ, input.projectId),
        ],
      })

    return await query.populate().exec()
  }

  @GraphQLOperation({
    type: "Query",
    input: z.object({
      id: z.string(),
    }),
    output: ModuleArcheType,
  })
  async getModule(input: { id: string }) {
    const entity = await new Query().findOneById(input.id);
    if (!entity) return null;
    return await ModuleArcheType.Unwrap(entity);
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      name: z.string(),
      description: z.string().optional(),
      projectId: z.string(),
    }),
    output: ModuleArcheType,
  })
  async createModule(input: {
    name: string;
    description?: string;
    projectId: string;
  }) {
    const entity = Entity.Create()
      .add(ModuleTag, {})
      .add(ModuleNameComponent, { value: input.name })
      .add(ModuleDescriptionComponent, { value: input.description ?? "" })
      .add(ModuleProjectRefComponent, { projectId: input.projectId });

    await entity.save();

    const saved = await new Query().findOneById(entity.id);
    if (!saved) throw new Error("Failed to create module");
    return await ModuleArcheType.Unwrap(saved);
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
    }),
    output: ModuleArcheType,
  })
  async updateModule(input: {
    id: string;
    name?: string;
    description?: string;
  }) {
    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Module not found");

    if (input.name !== undefined) {
      await entity.set(ModuleNameComponent, { value: input.name });
    }
    if (input.description !== undefined) {
      await entity.set(ModuleDescriptionComponent, { value: input.description });
    }
    await entity.save();

    return await ModuleArcheType.Unwrap(entity);
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({
      id: z.string(),
    }),
    output: "Boolean",
  })
  async deleteModule(input: { id: string }) {
    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Module not found");
    await entity.delete();
    return true;
  }
}
