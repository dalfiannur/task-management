import { BaseService } from "bunsane/service";
import { Entity } from 'bunsane/core/Entity';
import { Query } from 'bunsane/query';
import { GraphQLOperation } from "bunsane/gql";
import { z } from "zod";
import { UserProfile } from "../components/UserProfile";
import { UserArcheType } from "../archetypes/UserArcheType";
import { AuthPlugin } from "../plugins/AuthPlugin";

const userArcheType = new UserArcheType();

export async function findUserByExternalId(externalId: string) {
  const entities = await new Query()
    .with(UserProfile, {
      filters: [Query.typedFilter(UserProfile, "externalId", "=", externalId)],
    })
    .exec();
  return entities[0] ?? null;
}

export async function getUserRole(externalId: string): Promise<string> {
  const entities = await new Query()
    .with(UserProfile, {
      filters: [Query.typedFilter(UserProfile, "externalId", "=", externalId)],
    })
    .exec();
  const profile = entities[0] ? await entities[0].get(UserProfile) : null;
  return profile?.role ?? "member";
}

export async function requireManager(context: { request?: Request }) {
  if (!context.request) throw new Error("Authentication required");
  const user = await AuthPlugin.extractUser(context.request);
  if (!user) throw new Error("Authentication required");
  // const role = user.role ?? await getUserRole(user.id);
  // if (role !== "manager") throw new Error("Manager access required");
  return user;
}

export default class UserService extends BaseService {
  @GraphQLOperation({
    type: "Query",
    output: [userArcheType],
  })
  async listUsers() {
    const entities = await new Query().with(UserProfile).populate().exec();
    return await Promise.all(
      entities.map((e: any) => userArcheType.Unwrap(e)),
    );
  }

  @GraphQLOperation({
    type: "Query",
    output: userArcheType,
  })
  async me(_input: unknown, context: { user?: { id: string } }) {
    if (!context.user) return null;
    const entity = await findUserByExternalId(context.user.id);
    if (!entity) return null;
    return await userArcheType.Unwrap(entity);
  }

  @GraphQLOperation({
    type: "Mutation",
    input: z.object({ userId: z.string(), role: z.enum(["manager", "member"]) }),
    output: "Boolean",
  })
  async setUserRole(
    input: { userId: string; role: string },
    context: { request?: Request },
  ) {
    await requireManager(context);

    const user = await findUserByExternalId(input.userId);
    if (!user) throw new Error("User not found");
    await user.set(UserProfile, { role: input.role });
    await user.save();
    return true;
  }

  /**
   * Sync user profile from OIDC claims. Creates or updates the user entity.
   */
  async syncFromOIDC(claims: {
    sub: string;
    email: string;
    name: string;
    picture?: string;
    role?: string;
  }) {
    // Find existing user by externalId
    const existing = await new Query()
      .with(UserProfile, {
        filters: [
          Query.typedFilter(UserProfile, "externalId", "=", claims.sub),
        ],
      })
      .exec();

    if (existing.length > 0) {
      const entity = existing[0]!;
      const updates: Record<string, string> = {};

      // Only update fields that have actual values (access tokens may not carry these)
      if (claims.email) updates.email = claims.email;
      if (claims.name) updates.name = claims.name;
      if (claims.picture) updates.avatarUrl = claims.picture;

      // Update role if JWT provides it
      if (claims.role) {
        updates.role = claims.role;
      }

      await entity.set(UserProfile, updates);
      await entity.save();
      return entity;
    }

    // For new user: check if any managers exist. If none, promote to manager.
    let role = claims.role ?? "member";
    const managers = await new Query()
      .with(UserProfile, {
        filters: [Query.typedFilter(UserProfile, "role", "=", "manager")],
      })
      .exec();
    if (managers.length === 0) {
      role = "manager";
    }

    // Create new user
    const archetype = new UserArcheType();
    archetype.fill({
      userProfile: {
        externalId: claims.sub,
        email: claims.email,
        name: claims.name,
        avatarUrl: claims.picture ?? "",
        role,
      },
    });
    return await archetype.createAndSaveEntity();
  }
}
