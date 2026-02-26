import { BaseService } from "bunsane/service";
import { GraphQLOperation } from 'bunsane/gql';
import { Entity } from 'bunsane/core/Entity';
import { Query } from 'bunsane/query';
import { z } from "zod";
import { ModuleDescriptionComponent, ModuleNameComponent, ModulePicIdComponent, ModuleProjectRefComponent, ModuleTag } from "../components/ModuleComponents";
import { ModuleArcheType } from "../archetypes/ModuleArcheType";
import { ProjectTag, ProjectModuleRefComponent } from "../components/ProjectComponents";

export default class ModuleService extends BaseService {
  constructor() {
    super();
    ModuleArcheType.registerFieldResolvers(this);
  }

  @GraphQLOperation({
    type: "Query",
    input: z.object({
      _dummy: z.string().optional(),
    }),
    output: [ModuleArcheType],
  })
  async listAllModules() {
    const query = new Query()
      .with(ModuleTag)
      .with(ModuleNameComponent)
      .with(ModuleProjectRefComponent);

    return await query.populate().exec();
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
      .with(ModulePicIdComponent)
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
      picId: z.string().optional(),
    }),
    output: ModuleArcheType,
  })
  async createModule(input: {
    name: string;
    description?: string;
    projectId: string;
    picId?: string;
  }) {
    const entity = Entity.Create()
      .add(ModuleTag, {})
      .add(ModuleNameComponent, { value: input.name })
      .add(ModuleDescriptionComponent, { value: input.description ?? "" })
      .add(ModuleProjectRefComponent, { projectId: input.projectId });

    if (input.picId) {
      entity.add(ModulePicIdComponent, { value: input.picId });
    }

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
      picId: z.string().optional(),
    }),
    output: ModuleArcheType,
  })
  async updateModule(input: {
    id: string;
    name?: string;
    description?: string;
    picId?: string;
  }) {
    const entity = await new Query().findOneById(input.id);
    if (!entity) throw new Error("Module not found");

    if (input.name !== undefined) {
      await entity.set(ModuleNameComponent, { value: input.name });
    }
    if (input.description !== undefined) {
      await entity.set(ModuleDescriptionComponent, { value: input.description });
    }
    if (input.picId !== undefined) {
      await entity.set(ModulePicIdComponent, { value: input.picId });
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

    // Clear module links from sub-projects referencing this module
    const linkedSubProjects = await new Query()
      .with(ProjectTag)
      .with(ProjectModuleRefComponent, {
        filters: [Query.typedFilter(ProjectModuleRefComponent, "moduleId", "=", input.id)],
      })
      .exec();
    for (const sub of linkedSubProjects) {
      await sub.remove(ProjectModuleRefComponent);
      await sub.save();
    }

    await entity.delete();
    return true;
  }
}
