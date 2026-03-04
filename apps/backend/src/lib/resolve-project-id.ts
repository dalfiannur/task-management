import { Entity } from "bunsane/core/Entity";
import { Query } from "bunsane/query";
import { ProjectTag, ProjectCoreRefComponent } from "~/components/ProjectComponents";

/**
 * Resolve a project ID that may be a Core Portal ID to the local entity ID.
 * If the ID matches a local entity, returns it as-is.
 * Otherwise, looks up via ProjectCoreRefComponent.
 */
export async function resolveLocalProjectId(id: string): Promise<string> {
  const entity = await Entity.FindById(id);
  if (entity) return id;
  const results = await new Query()
    .with(ProjectTag)
    .with(ProjectCoreRefComponent, {
      filters: [
        Query.filter("value", Query.filterOp.EQ, id),
      ],
    })
    .populate()
    .exec();
  return results[0]?.id ?? id;
}
