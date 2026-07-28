// apps/backend/src/services/UserService.ts
import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import { t } from "bunsane/gql/schema";
import { Entity } from "bunsane/core/Entity";
import { Query } from "bunsane/query";
import { GraphQLError } from "graphql";
import {
  PhoneComponent,
  PasswordComponent,
  UserProfileComponent,
  UserStatusComponent,
  UserTag,
  AdminTag,
} from "~/components/UserComponents";
import { serializeUser, hashPassword, findUserByPhone, type UserJSON } from "~/lib/user-serializer";
import { requireUser, requireAdmin, type AuthContext } from "~/auth";

async function allUserEntities(): Promise<Entity[]> {
  return await new Query().with(UserTag).with(UserProfileComponent).take(10000).exec();
}

export default class UserService extends BaseService {
  // ---- Directory (any authenticated user) ----

  @GraphQLOperation({
    type: "Query",
    input: { q: t.string() },
    output: "JSON",
  })
  async searchUsers(input: { q?: string }, context: AuthContext): Promise<UserJSON[]> {
    requireUser(context);
    const q = (input.q ?? "").trim().toLowerCase();
    const entities = await allUserEntities();
    const users = await Promise.all(entities.map((e) => serializeUser(e)));
    const active = users.filter((u) => u.status === "active");
    if (!q) return active;
    return active.filter(
      (u) => u.displayName.toLowerCase().includes(q) || u.phone.includes(q),
    );
  }

  @GraphQLOperation({
    type: "Query",
    input: { id: t.string().required() },
    output: "JSON",
  })
  async getUser(input: { id: string }, context: AuthContext): Promise<UserJSON | null> {
    requireUser(context);
    const entity = await Entity.FindById(input.id);
    if (!entity) return null;
    return await serializeUser(entity);
  }

  // ---- Admin management ----

  @GraphQLOperation({
    type: "Query",
    input: { status: t.string() },
    output: "JSON",
  })
  async listUsers(input: { status?: string }, context: AuthContext): Promise<UserJSON[]> {
    requireAdmin(context);
    const entities = await allUserEntities();
    const users = await Promise.all(entities.map((e) => serializeUser(e)));
    if (input.status) return users.filter((u) => u.status === input.status);
    return users;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      phone: t.string().required(),
      password: t.string().required(),
      displayName: t.string().required(),
      isAdmin: t.boolean(),
    },
    output: "JSON",
  })
  async createUser(
    input: { phone: string; password: string; displayName: string; isAdmin?: boolean },
    context: AuthContext,
  ): Promise<UserJSON> {
    requireAdmin(context);
    if (input.password.length < 6) {
      throw new GraphQLError("Password must be at least 6 characters", { extensions: { code: "BAD_REQUEST" } });
    }
    const phone = input.phone.trim();
    if (await findUserByPhone(phone)) {
      throw new GraphQLError("Phone number already registered", { extensions: { code: "BAD_REQUEST" } });
    }
    const hash = await hashPassword(input.password);
    const entity = Entity.Create()
      .add(UserTag, {})
      .add(PhoneComponent, { value: phone, verified: false })
      .add(PasswordComponent, { hash, changedAt: new Date() })
      .add(UserProfileComponent, { displayName: input.displayName.trim(), avatarUrl: "", email: "" })
      .add(UserStatusComponent, { value: "active", createdAt: new Date(), lastLoginAt: null });
    if (input.isAdmin) entity.add(AdminTag, {});
    await entity.save();
    return await serializeUser(entity);
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      id: t.string().required(),
      displayName: t.string(),
      email: t.string(),
      avatarUrl: t.string(),
    },
    output: "JSON",
  })
  async updateUser(
    input: { id: string; displayName?: string; email?: string; avatarUrl?: string },
    context: AuthContext,
  ): Promise<UserJSON> {
    requireAdmin(context);
    const entity = await Entity.FindById(input.id);
    if (!entity) throw new GraphQLError("User not found", { extensions: { code: "NOT_FOUND" } });
    const updates: Record<string, unknown> = {};
    if (input.displayName !== undefined) updates.displayName = input.displayName;
    if (input.email !== undefined) updates.email = input.email;
    if (input.avatarUrl !== undefined) updates.avatarUrl = input.avatarUrl;
    if (Object.keys(updates).length > 0) {
      await entity.set(UserProfileComponent, updates);
      await entity.save();
    }
    return await serializeUser(entity);
  }

  @GraphQLOperation({
    type: "Mutation",
    input: { id: t.string().required() },
    output: "JSON",
  })
  async activateUser(input: { id: string }, context: AuthContext): Promise<UserJSON> {
    return await this.setStatus(input.id, "active", context);
  }

  @GraphQLOperation({
    type: "Mutation",
    input: { id: t.string().required() },
    output: "JSON",
  })
  async suspendUser(input: { id: string }, context: AuthContext): Promise<UserJSON> {
    return await this.setStatus(input.id, "suspended", context);
  }

  private async setStatus(id: string, value: "active" | "suspended", context: AuthContext): Promise<UserJSON> {
    requireAdmin(context);
    const entity = await Entity.FindById(id);
    if (!entity) throw new GraphQLError("User not found", { extensions: { code: "NOT_FOUND" } });
    await entity.set(UserStatusComponent, { value });
    await entity.save();
    return await serializeUser(entity);
  }

  @GraphQLOperation({
    type: "Mutation",
    input: { id: t.string().required(), isAdmin: t.boolean().required() },
    output: "JSON",
  })
  async setAdmin(input: { id: string; isAdmin: boolean }, context: AuthContext): Promise<UserJSON> {
    requireAdmin(context);
    const entity = await Entity.FindById(input.id);
    if (!entity) throw new GraphQLError("User not found", { extensions: { code: "NOT_FOUND" } });
    const has = await entity.has(AdminTag);
    if (input.isAdmin && !has) entity.add(AdminTag, {});
    if (!input.isAdmin && has) await entity.remove(AdminTag);
    await entity.save();
    return await serializeUser(entity);
  }

  @GraphQLOperation({
    type: "Mutation",
    input: { id: t.string().required(), newPassword: t.string().required() },
    output: "Boolean",
  })
  async resetPassword(input: { id: string; newPassword: string }, context: AuthContext): Promise<boolean> {
    requireAdmin(context);
    const entity = await Entity.FindById(input.id);
    if (!entity) throw new GraphQLError("User not found", { extensions: { code: "NOT_FOUND" } });
    const hash = await hashPassword(input.newPassword);
    await entity.set(PasswordComponent, { hash, changedAt: new Date() });
    await entity.save();
    return true;
  }

  @GraphQLOperation({
    type: "Mutation",
    input: { id: t.string().required() },
    output: "Boolean",
  })
  async deleteUser(input: { id: string }, context: AuthContext): Promise<boolean> {
    requireAdmin(context);
    const entity = await Entity.FindById(input.id);
    if (!entity) throw new GraphQLError("User not found", { extensions: { code: "NOT_FOUND" } });
    await entity.delete();
    return true;
  }
}
