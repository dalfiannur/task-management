import { BaseService } from "bunsane/service";
import { GraphQLOperation } from 'bunsane/gql';
import { t } from 'bunsane/gql/schema';
import { Entity } from 'bunsane/core/Entity';
import { Query } from 'bunsane/query';
import { ModuleDescriptionComponent, ModuleNameComponent, ModuleOrderComponent, ModulePicIdComponent, ModuleProjectRefComponent, ModuleTag } from "../components/ModuleComponents";
import { ModuleArcheType } from "../archetypes/ModuleArcheType";
import { ProjectTag, ProjectModuleRefComponent } from "../components/ProjectComponents";
import { resolveLocalProjectId } from "~/lib/resolve-project-id";
import { requirePermission, type AuthContext, TasksResources, Action } from "~/utils/auth";

export default class ModuleService extends BaseService {
  constructor() {
    super();
    ModuleArcheType.registerFieldResolvers(this);
  }


  @GraphQLOperation({
    type: "Query",
    input: {
      _dummy: t.string(),
    },
    output: [ModuleArcheType],
  })
  async listAllModules(_input: unknown, context: AuthContext) {
    requirePermission(context, TasksResources.Tasks, Action.Read);
    const query = new Query()
      .with(ModuleTag)
      .with(ModuleNameComponent)
      .with(ModuleProjectRefComponent);

    return await query.populate().exec();
  }

  @GraphQLOperation({
    type: "Query",
    input: {
      projectId: t.string().required(),
    },
    output: [ModuleArcheType],
  })
  async listModules(input: { projectId: string }, context: AuthContext) {
    requirePermission(context, TasksResources.Tasks, Action.Read);
    const localProjectId = await resolveLocalProjectId(input.projectId);
    return await new Query()
      .with(ModuleTag)
      .with(ModuleNameComponent)
      .with(ModuleOrderComponent)
      .with(ModuleProjectRefComponent, {
        filters: [
          Query.filter("projectId", Query.filterOp.EQ, localProjectId),
        ],
      })
      .sortBy(ModuleOrderComponent, "value", "ASC")
      .populate()
      .exec();
  }

  @GraphQLOperation({
    type: "Query",
    input: {
      id: t.string().required(),
    },
    output: ModuleArcheType,
  })
  async getModule(input: { id: string }, context: AuthContext) {
    requirePermission(context, TasksResources.Tasks, Action.Read);
    const entity = await new Query().findOneById(input.id);
    if (!entity) return null;
    return await ModuleArcheType.Unwrap(entity);
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      name: t.string().required(),
      description: t.string(),
      projectId: t.string().required(),
      picId: t.string(),
    },
    output: ModuleArcheType,
  })
  async createModule(input: {
    name: string;
    description?: string;
    projectId: string;
    picId?: string;
  }, context: AuthContext) {
    requirePermission(context, TasksResources.Tasks, Action.Create);
    const localProjectId = await resolveLocalProjectId(input.projectId);
    // Shift existing modules' order +1 so new module appears at top
    const existing = await new Query()
      .with(ModuleTag)
      .with(ModuleProjectRefComponent, {
        filters: [
          Query.filter("projectId", Query.filterOp.EQ, localProjectId),
        ],
      })
      .exec();
    for (const e of existing) {
      const currentOrder = (await e.get(ModuleOrderComponent))?.value ?? 0;
      await e.set(ModuleOrderComponent, { value: currentOrder + 1 });
      await e.save();
    }

    const entity = Entity.Create()
      .add(ModuleTag, {})
      .add(ModuleNameComponent, { value: input.name })
      .add(ModuleDescriptionComponent, { value: input.description ?? "" })
      .add(ModuleOrderComponent, { value: 0 })
      .add(ModuleProjectRefComponent, { projectId: localProjectId });

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
    input: {
      id: t.string().required(),
      name: t.string(),
      description: t.string(),
      picId: t.string(),
    },
    output: ModuleArcheType,
  })
  async updateModule(input: {
    id: string;
    name?: string;
    description?: string;
    picId?: string;
  }, context: AuthContext) {
    requirePermission(context, TasksResources.Tasks, Action.Update);
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
    input: {
      id: t.string().required(),
    },
    output: "Boolean",
  })
  async deleteModule(input: { id: string }, context: AuthContext) {
    requirePermission(context, TasksResources.Tasks, Action.Delete);
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

  @GraphQLOperation({
    type: "Mutation",
    input: {
      projectId: t.string().required(),
      moduleIds: t.list(t.string()).required(),
    },
    output: "Boolean",
  })
  async reorderModules(input: { projectId: string; moduleIds: string[] }, context: AuthContext) {
    requirePermission(context, TasksResources.Tasks, Action.Update);
    if (input.moduleIds.length === 0) return true;

    // Fetch all modules in parallel
    const entities = await Promise.all(
      input.moduleIds.map((id) => Entity.FindById(id))
    );

    // Update order for each module
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      if (entity) {
        await entity.set(ModuleOrderComponent, { value: i });
        await entity.save();
      }
    }
    return true;
  }
}
