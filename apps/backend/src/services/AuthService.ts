// apps/backend/src/services/AuthService.ts
import { BaseService } from "bunsane/service";
import { GraphQLOperation } from "bunsane/gql";
import { t } from "bunsane/gql/schema";
import { Entity } from "bunsane/core/Entity";
import { GraphQLError } from "graphql";
import {
  PhoneComponent,
  PasswordComponent,
  UserProfileComponent,
  UserStatusComponent,
  UserTag,
} from "~/components/UserComponents";
import { serializeUser, hashPassword, verifyPassword, toAuthUser, findUserByPhone } from "~/lib/user-serializer";
import { signToken, requireUser, type AuthContext } from "~/auth";

export default class AuthService extends BaseService {
  @GraphQLOperation({
    type: "Mutation",
    input: {
      phone: t.string().required(),
      password: t.string().required(),
      displayName: t.string().required(),
    },
    output: "JSON",
  })
  async register(input: { phone: string; password: string; displayName: string }, _context: AuthContext) {
    const phone = input.phone.trim();
    if (!phone || input.password.length < 6) {
      throw new GraphQLError("Phone required and password must be at least 6 characters", {
        extensions: { code: "BAD_REQUEST" },
      });
    }
    if (await findUserByPhone(phone)) {
      throw new GraphQLError("Phone number already registered", { extensions: { code: "BAD_REQUEST" } });
    }

    const hash = await hashPassword(input.password);
    const entity = Entity.Create()
      .add(UserTag, {})
      .add(PhoneComponent, { value: phone, verified: false })
      .add(PasswordComponent, { hash, changedAt: new Date() })
      .add(UserProfileComponent, { displayName: input.displayName.trim(), avatarUrl: "", email: "" })
      .add(UserStatusComponent, { value: "pending", createdAt: new Date(), lastLoginAt: null });
    await entity.save();

    // No token — a pending user cannot log in until an admin approves.
    return { user: await serializeUser(entity) };
  }

  @GraphQLOperation({
    type: "Mutation",
    input: {
      phone: t.string().required(),
      password: t.string().required(),
    },
    output: "JSON",
  })
  async login(input: { phone: string; password: string }, _context: AuthContext) {
    const entity = await findUserByPhone(input.phone.trim());
    if (!entity) {
      throw new GraphQLError("Invalid phone or password", { extensions: { code: "UNAUTHENTICATED" } });
    }
    const pw = await entity.get(PasswordComponent);
    if (!pw || !(await verifyPassword(input.password, pw.hash))) {
      throw new GraphQLError("Invalid phone or password", { extensions: { code: "UNAUTHENTICATED" } });
    }
    const status = await entity.get(UserStatusComponent);
    if (status?.value === "pending") {
      throw new GraphQLError("Account awaiting admin approval", { extensions: { code: "FORBIDDEN" } });
    }
    if (status?.value === "suspended") {
      throw new GraphQLError("Account suspended", { extensions: { code: "FORBIDDEN" } });
    }

    await entity.set(UserStatusComponent, { lastLoginAt: new Date() });
    await entity.save();

    const user = await serializeUser(entity);
    const token = await signToken(toAuthUser(user));
    return { token, user };
  }

  // bunsane expects at least one input field; use the `_dummy` convention (see NotificationService).
  @GraphQLOperation({
    type: "Query",
    input: { _dummy: t.boolean() },
    output: "JSON",
  })
  async me(_input: unknown, context: AuthContext) {
    const authUser = requireUser(context);
    const entity = await Entity.FindById(authUser.id);
    if (!entity) return null;
    return await serializeUser(entity);
  }
}
