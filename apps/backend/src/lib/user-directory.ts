// apps/backend/src/lib/user-directory.ts
import { Query } from "bunsane/query";
import { UserTag, UserStatusComponent } from "~/components/UserComponents";

/** All active user ids — used to auto-populate project membership on approval. */
export async function listActiveUserIds(): Promise<string[]> {
  const entities = await new Query()
    .with(UserTag)
    .with(UserStatusComponent, {
      filters: [Query.typedFilter(UserStatusComponent, "value", "=", "active")],
    })
    .take(10000)
    .exec();
  return entities.map((e) => e.id);
}
