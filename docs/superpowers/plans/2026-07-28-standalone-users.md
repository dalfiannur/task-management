# Standalone Users for Task Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Task Management's dependency on the Sedjiwa OIDC server and the `@qyubit/sedjiwa-permissions` package with a self-contained local user system — phone+password login, a locally-issued JWT, a local user directory, and admin user management.

**Architecture:** A local `~/auth/` module reimplements the small permission/JWT surface (no OIDC, no remote JWKS). A User ECS domain (components + archetype) plus `AuthService` (register/login/me) and `UserService` (directory + admin) live in the tasks backend. `AuthPlugin` verifies the local JWT. The frontend swaps `react-oidc-context` for a Zustand auth store with `/login` + `/register` pages and an admin users page. Registration creates a `pending` user that an admin must approve before login.

**Tech Stack:** Bun, bunsane (ECS + GraphQL), `jose` (JWT HS256), `Bun.password` (hashing), React 19, React Router v7, Apollo Client, Zustand, shadcn/ui.

**Reference conventions (from the existing codebase):**
- GraphQL op: `@GraphQLOperation({ type, input, output })` on a `BaseService` method `(input, context: AuthContext)`.
- Custom output shapes use `output: "JSON"` (returns a plain object; the frontend queries the field as a scalar, no subfield selection). This is already used by `DashboardService` and several `TaskService` ops.
- Entity create: `Entity.Create().add(Tag, {}).add(Comp, { ...data })` then `await entity.save()`.
- Entity read/update: `Entity.FindById(id)`, `entity.get(Comp)`, `entity.has(Tag)`, `entity.set(Comp, updates)`, `entity.add(Comp, data)`, `entity.remove(Comp)`, `await entity.save()`, `entity.delete()`.
- Query: `new Query().with(Comp, { filters: [Query.typedFilter(Comp, "field", "=", val)] }).take(N).exec()`. Per repo convention add explicit `.take(1)` for single lookups, `.take(10000)` for list queries.
- Tests use Bun's built-in runner: `import { expect, test } from "bun:test"`; files named `*.test.ts`; run with `bun test <path>`.

**Canonical types used across tasks (define once in Task 1, reference everywhere):**

```typescript
// AuthUser — the shape carried on context.user after this refactor (replaces SedjiwaTokenPayload)
type AuthUser = {
  id: string;            // was user.sub
  phone: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  isAdmin: boolean;
  permissions: string[]; // admin => ["*"], member => []
};

// UserJSON — flat serialized user returned by all auth/user GraphQL ops (output: "JSON")
type UserJSON = {
  id: string;
  phone: string;
  displayName: string;
  email: string;
  avatarUrl: string;
  isAdmin: boolean;
  status: "pending" | "active" | "suspended";
  createdAt: string | null;
  lastLoginAt: string | null;
};
```

---

## Phase 1 — Local auth/permissions module (`apps/backend/src/auth/`)

### Task 1: Auth types

**Files:**
- Create: `apps/backend/src/auth/types.ts`

- [ ] **Step 1: Write the types module**

```typescript
// apps/backend/src/auth/types.ts

export const Action = {
  Create: "create",
  Read: "read",
  Update: "update",
  Delete: "delete",
  Assign: "assign",
  CreateAll: "create_all",
  ReadAll: "read_all",
  UpdateAll: "update_all",
  DeleteAll: "delete_all",
  AssignAll: "assign_all",
} as const;

export type ActionName = (typeof Action)[keyof typeof Action] | (string & Record<never, never>);
export type Action = ActionName;

export interface PermissionEntry {
  resource: string;
  action: ActionName;
  description: string;
}

export interface PermissionManifest {
  app: string;
  version: string;
  permissions: PermissionEntry[];
}

export interface AuthUser {
  id: string;
  phone: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  isAdmin: boolean;
  permissions: string[];
}

export interface AuthContext {
  user: AuthUser | null;
  request: Request;
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/backend && bun run tsc --noEmit`
Expected: PASS (no errors from `src/auth/types.ts`).

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/auth/types.ts
git commit -m "feat(auth): add local auth types"
```

---

### Task 2: Permission helpers + resource manifests

**Files:**
- Create: `apps/backend/src/auth/permissions.ts`
- Test: `apps/backend/src/auth/permissions.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/backend/src/auth/permissions.test.ts
import { expect, test } from "bun:test";
import { hasPermission, TasksResources, TASKS_PERMISSIONS } from "./permissions";

test("wildcard grants everything", () => {
  expect(hasPermission(["*"], "tasks:tasks", "read")).toBe(true);
});

test("exact permission grants", () => {
  expect(hasPermission(["tasks:tasks:read"], "tasks:tasks", "read")).toBe(true);
});

test("read_all implies read", () => {
  expect(hasPermission(["tasks:tasks:read_all"], "tasks:tasks", "read")).toBe(true);
});

test("parent manage grants child", () => {
  expect(hasPermission(["tasks:manage"], "tasks:tasks", "delete")).toBe(true);
});

test("missing permission denied", () => {
  expect(hasPermission([], "tasks:tasks", "read")).toBe(false);
});

test("resource constants and manifest exist", () => {
  expect(TasksResources.Tasks).toBe("tasks:tasks");
  expect(TASKS_PERMISSIONS.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && bun test src/auth/permissions.test.ts`
Expected: FAIL — cannot find module `./permissions`.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/backend/src/auth/permissions.ts
import { Action, type PermissionEntry } from "./types";

export function hasPermission(userPermissions: string[], resource: string, action: string): boolean {
  if (userPermissions.includes("*")) return true;
  if (userPermissions.includes(`${resource}:${action}`)) return true;
  if (userPermissions.includes(`${resource}:manage`)) return true;
  if (userPermissions.includes(`${resource}:${action}_all`)) return true;

  const segments = resource.split(":");
  for (let i = segments.length - 1; i >= 1; i--) {
    const parent = segments.slice(0, i).join(":");
    if (userPermissions.includes(`${parent}:manage`)) return true;
  }
  return false;
}

export const TasksResources = {
  Projects: "tasks:projects",
  Modules: "tasks:modules",
  Tasks: "tasks:tasks",
  SubProjects: "tasks:subprojects",
} as const;

// Kept for parity with existing call-sites that reference CoreResources.Projects.
export const CoreResources = {
  Projects: "core:projects",
  Companies: "core:companies",
  Divisions: "core:divisions",
} as const;

export const TASKS_PERMISSIONS: PermissionEntry[] = [
  { resource: TasksResources.Projects, action: Action.Create, description: "Create self projects" },
  { resource: TasksResources.Projects, action: Action.Read, description: "Read self project information" },
  { resource: TasksResources.Projects, action: Action.Update, description: "Update self projects" },
  { resource: TasksResources.Projects, action: Action.Delete, description: "Delete self projects" },
  { resource: TasksResources.Projects, action: Action.ReadAll, description: "Read all project information" },
  { resource: TasksResources.Projects, action: Action.UpdateAll, description: "Update all projects" },
  { resource: TasksResources.Projects, action: Action.DeleteAll, description: "Delete all projects" },
  { resource: TasksResources.Modules, action: Action.Create, description: "Create self modules" },
  { resource: TasksResources.Modules, action: Action.Read, description: "Read self module information" },
  { resource: TasksResources.Modules, action: Action.Update, description: "Update self modules" },
  { resource: TasksResources.Modules, action: Action.Delete, description: "Delete self modules" },
  { resource: TasksResources.Modules, action: Action.Assign, description: "Assign self modules to users" },
  { resource: TasksResources.Modules, action: Action.ReadAll, description: "Read all module information" },
  { resource: TasksResources.Modules, action: Action.UpdateAll, description: "Update all modules" },
  { resource: TasksResources.Tasks, action: Action.Create, description: "Create self tasks" },
  { resource: TasksResources.Tasks, action: Action.Read, description: "Read self task information" },
  { resource: TasksResources.Tasks, action: Action.Update, description: "Update self tasks" },
  { resource: TasksResources.Tasks, action: Action.Delete, description: "Delete self tasks" },
  { resource: TasksResources.Tasks, action: Action.Assign, description: "Assign self tasks to users" },
  { resource: TasksResources.Tasks, action: Action.ReadAll, description: "Read all task information" },
  { resource: TasksResources.Tasks, action: Action.UpdateAll, description: "Update all tasks" },
  { resource: TasksResources.SubProjects, action: Action.Create, description: "Create subprojects" },
  { resource: TasksResources.SubProjects, action: Action.Read, description: "Read subproject information" },
  { resource: TasksResources.SubProjects, action: Action.Update, description: "Update subprojects" },
  { resource: TasksResources.SubProjects, action: Action.Delete, description: "Delete subprojects" },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && bun test src/auth/permissions.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/auth/permissions.ts apps/backend/src/auth/permissions.test.ts
git commit -m "feat(auth): add local permission helpers and manifest"
```

---

### Task 3: Local JWT sign/verify

**Files:**
- Create: `apps/backend/src/auth/jwt.ts`
- Test: `apps/backend/src/auth/jwt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/backend/src/auth/jwt.test.ts
import { expect, test } from "bun:test";
import { signToken, verifyToken } from "./jwt";
import type { AuthUser } from "./types";

const admin: AuthUser = {
  id: "u1", phone: "0811", displayName: "Admin",
  email: "a@x.io", avatarUrl: "", isAdmin: true, permissions: ["*"],
};

test("signToken/verifyToken round-trips a user", async () => {
  const token = await signToken(admin);
  const decoded = await verifyToken(token);
  expect(decoded).not.toBeNull();
  expect(decoded!.id).toBe("u1");
  expect(decoded!.displayName).toBe("Admin");
  expect(decoded!.isAdmin).toBe(true);
  expect(decoded!.permissions).toContain("*");
});

test("verifyToken returns null for garbage", async () => {
  expect(await verifyToken("not.a.jwt")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && bun test src/auth/jwt.test.ts`
Expected: FAIL — cannot find module `./jwt`.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/backend/src/auth/jwt.ts
import * as jose from "jose";
import type { AuthUser } from "./types";

const SECRET = new TextEncoder().encode(
  process.env.AUTH_JWT_SECRET ?? "dev-insecure-secret-change-me",
);
const EXPIRES_IN = process.env.AUTH_JWT_EXPIRES_IN ?? "7d";
const ISSUER = "task-management";

export async function signToken(user: AuthUser): Promise<string> {
  return await new jose.SignJWT({
    name: user.displayName,
    phone: user.phone,
    email: user.email ?? "",
    picture: user.avatarUrl ?? "",
    permissions: user.permissions,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(EXPIRES_IN)
    .sign(SECRET);
}

export async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jose.jwtVerify(token, SECRET, { issuer: ISSUER });
    if (!payload.sub) return null;
    const permissions = (payload.permissions as string[] | undefined) ?? [];
    return {
      id: payload.sub,
      phone: (payload.phone as string) ?? "",
      displayName: (payload.name as string) ?? "",
      email: (payload.email as string) || undefined,
      avatarUrl: (payload.picture as string) || undefined,
      isAdmin: permissions.includes("*"),
      permissions,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && bun test src/auth/jwt.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/auth/jwt.ts apps/backend/src/auth/jwt.test.ts
git commit -m "feat(auth): add local JWT sign/verify"
```

---

### Task 4: GraphQL guards + module barrel

**Files:**
- Create: `apps/backend/src/auth/guards.ts`
- Create: `apps/backend/src/auth/index.ts`

- [ ] **Step 1: Write the guards**

```typescript
// apps/backend/src/auth/guards.ts
import { GraphQLError } from "graphql";
import type { AuthContext, AuthUser } from "./types";
import { hasPermission } from "./permissions";

export function requireUser(context: AuthContext): AuthUser {
  if (!context.user) {
    throw new GraphQLError("Authentication required", { extensions: { code: "UNAUTHENTICATED" } });
  }
  return context.user;
}

export function requirePermission(context: AuthContext, resource: string, action: string): AuthUser {
  const user = requireUser(context);
  if (!hasPermission(user.permissions ?? [], resource, action)) {
    throw new GraphQLError(`Missing permission: ${resource}:${action}`, { extensions: { code: "FORBIDDEN" } });
  }
  return user;
}

export function requireAdmin(context: AuthContext): AuthUser {
  const user = requireUser(context);
  if (!user.isAdmin && !(user.permissions ?? []).includes("*")) {
    throw new GraphQLError("Admin access required", { extensions: { code: "FORBIDDEN" } });
  }
  return user;
}
```

- [ ] **Step 2: Write the barrel export**

```typescript
// apps/backend/src/auth/index.ts
export * from "./types";
export * from "./permissions";
export * from "./guards";
export * from "./jwt";
```

- [ ] **Step 3: Type-check**

Run: `cd apps/backend && bun run tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/auth/guards.ts apps/backend/src/auth/index.ts
git commit -m "feat(auth): add graphql guards and module barrel"
```

---

## Phase 2 — User ECS domain

### Task 5: User components

**Files:**
- Create: `apps/backend/src/components/UserComponents.ts`

- [ ] **Step 1: Write the components**

```typescript
// apps/backend/src/components/UserComponents.ts
import { BaseComponent, CompData, Component } from "bunsane/core/components";

@Component
export class UserTag extends BaseComponent {}

@Component
export class AdminTag extends BaseComponent {}

@Component
export class PhoneComponent extends BaseComponent {
  @CompData({ indexed: true })
  value: string = "";

  @CompData()
  verified: boolean = false;
}

@Component
export class PasswordComponent extends BaseComponent {
  @CompData()
  hash: string = "";

  @CompData()
  changedAt: Date = new Date();
}

@Component
export class UserProfileComponent extends BaseComponent {
  @CompData({ indexed: true })
  displayName: string = "";

  @CompData()
  avatarUrl: string = "";

  @CompData()
  email: string = "";
}

@Component
export class UserStatusComponent extends BaseComponent {
  @CompData({ indexed: true })
  value: string = "pending"; // pending | active | suspended

  @CompData()
  createdAt: Date = new Date();

  @CompData()
  lastLoginAt: Date | null = null;
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/backend && bun run tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/components/UserComponents.ts
git commit -m "feat(users): add user ECS components"
```

---

### Task 6: User archetype

**Files:**
- Create: `apps/backend/src/archetypes/UserArcheType.ts`
- Modify: `apps/backend/src/archetypes/ArcheTypeNames.ts`

- [ ] **Step 1: Add the archetype name**

In `apps/backend/src/archetypes/ArcheTypeNames.ts`, add a `User` entry to the object (place it after `TaskMediaLink`):

```typescript
    TaskMediaLink: "TaskMediaLink",
    User: "User",
} as const;
```

- [ ] **Step 2: Write the archetype**

```typescript
// apps/backend/src/archetypes/UserArcheType.ts
import {
  ArcheType,
  ArcheTypeField,
  BaseArcheType,
  type ArcheTypeOwnProperties,
} from "bunsane/core/ArcheType";
import {
  PhoneComponent,
  UserProfileComponent,
  UserStatusComponent,
} from "../components/UserComponents";
import { ArcheTypeNames } from "./ArcheTypeNames";

@ArcheType(ArcheTypeNames.User)
export class UserArcheTypeClass extends BaseArcheType {
  @ArcheTypeField(PhoneComponent)
  phone!: PhoneComponent;

  @ArcheTypeField(UserProfileComponent)
  profile!: UserProfileComponent;

  @ArcheTypeField(UserStatusComponent)
  status!: UserStatusComponent;
}

export type IUserArcheType = ArcheTypeOwnProperties<UserArcheTypeClass>;
```

- [ ] **Step 3: Type-check**

Run: `cd apps/backend && bun run tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/archetypes/UserArcheType.ts apps/backend/src/archetypes/ArcheTypeNames.ts
git commit -m "feat(users): add user archetype"
```

---

## Phase 3 — Auth & User services

### Task 7: Shared user serializer + password util

**Files:**
- Create: `apps/backend/src/lib/user-serializer.ts`
- Test: `apps/backend/src/lib/user-serializer.test.ts`

This centralizes `UserJSON` serialization and password hashing so `AuthService`, `UserService`, and the seed script share one implementation (DRY).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/backend/src/lib/user-serializer.test.ts
import { expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "./user-serializer";

test("hashPassword + verifyPassword round-trip", async () => {
  const hash = await hashPassword("s3cret");
  expect(hash).not.toBe("s3cret");
  expect(await verifyPassword("s3cret", hash)).toBe(true);
  expect(await verifyPassword("wrong", hash)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && bun test src/lib/user-serializer.test.ts`
Expected: FAIL — cannot find module `./user-serializer`.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/backend/src/lib/user-serializer.ts
import type { Entity } from "bunsane/core/Entity";
import {
  PhoneComponent,
  UserProfileComponent,
  UserStatusComponent,
  AdminTag,
} from "~/components/UserComponents";
import type { AuthUser } from "~/auth";

export type UserJSON = {
  id: string;
  phone: string;
  displayName: string;
  email: string;
  avatarUrl: string;
  isAdmin: boolean;
  status: "pending" | "active" | "suspended";
  createdAt: string | null;
  lastLoginAt: string | null;
};

export async function hashPassword(plain: string): Promise<string> {
  return await Bun.password.hash(plain);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return await Bun.password.verify(plain, hash);
}

export async function serializeUser(entity: Entity): Promise<UserJSON> {
  const phone = await entity.get(PhoneComponent);
  const profile = await entity.get(UserProfileComponent);
  const status = await entity.get(UserStatusComponent);
  const isAdmin = await entity.has(AdminTag);
  return {
    id: entity.id,
    phone: phone?.value ?? "",
    displayName: profile?.displayName ?? "",
    email: profile?.email ?? "",
    avatarUrl: profile?.avatarUrl ?? "",
    isAdmin,
    status: (status?.value as UserJSON["status"]) ?? "active",
    createdAt: status?.createdAt ? new Date(status.createdAt).toISOString() : null,
    lastLoginAt: status?.lastLoginAt ? new Date(status.lastLoginAt).toISOString() : null,
  };
}

// Build the AuthUser (for JWT) from a serialized user.
export function toAuthUser(u: UserJSON): AuthUser {
  return {
    id: u.id,
    phone: u.phone,
    displayName: u.displayName,
    email: u.email || undefined,
    avatarUrl: u.avatarUrl || undefined,
    isAdmin: u.isAdmin,
    permissions: u.isAdmin ? ["*"] : [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && bun test src/lib/user-serializer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lib/user-serializer.ts apps/backend/src/lib/user-serializer.test.ts
git commit -m "feat(users): add user serializer and password utils"
```

---

### Task 8: AuthService (register / login / me)

**Files:**
- Create: `apps/backend/src/services/AuthService.ts`

- [ ] **Step 1: Write the service**

```typescript
// apps/backend/src/services/AuthService.ts
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
} from "~/components/UserComponents";
import { serializeUser, hashPassword, verifyPassword, toAuthUser } from "~/lib/user-serializer";
import { signToken, requireUser, type AuthContext } from "~/auth";

async function findUserByPhone(phone: string): Promise<Entity | null> {
  const matches = await new Query()
    .with(PhoneComponent, { filters: [Query.typedFilter(PhoneComponent, "value", "=", phone)] })
    .take(1)
    .exec();
  return matches[0] ?? null;
}

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

  // Note: bunsane in this codebase expects at least one input field; use the
  // established `_dummy` convention (see NotificationService) for no-arg ops.
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
```

- [ ] **Step 2: Type-check**

Run: `cd apps/backend && bun run tsc --noEmit`
Expected: PASS. (Note: `AuthService` is registered in Task 11; a full runtime check happens after that.)

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/services/AuthService.ts
git commit -m "feat(auth): add register/login/me service"
```

---

### Task 9: UserService (directory + admin management)

**Files:**
- Create: `apps/backend/src/services/UserService.ts`

- [ ] **Step 1: Write the service**

```typescript
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
import { serializeUser, hashPassword, type UserJSON } from "~/lib/user-serializer";
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
    const phone = input.phone.trim();
    const existing = await new Query()
      .with(PhoneComponent, { filters: [Query.typedFilter(PhoneComponent, "value", "=", phone)] })
      .take(1)
      .exec();
    if (existing.length > 0) {
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
```

- [ ] **Step 2: Type-check**

Run: `cd apps/backend && bun run tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/services/UserService.ts
git commit -m "feat(users): add user directory + admin management service"
```

---

## Phase 4 — Wire backend & refactor identity

### Task 10: Rewrite AuthPlugin to verify the local JWT

**Files:**
- Modify: `apps/backend/src/plugins/AuthPlugin.ts` (full rewrite)

- [ ] **Step 1: Replace the file contents**

```typescript
// apps/backend/src/plugins/AuthPlugin.ts
import App from "bunsane/core/App";
import BasePlugin from "bunsane/plugins";
import { verifyToken, type AuthUser } from "~/auth";

export class AuthPlugin extends BasePlugin {
  name = "AuthPlugin";
  version = "2.0.0";

  async init(_app: App) {
    console.log("[AuthPlugin] Local JWT auth enabled (issuer: task-management)");
    if (!process.env.AUTH_JWT_SECRET) {
      console.warn("[AuthPlugin] AUTH_JWT_SECRET is not set — using an insecure development secret");
    }
  }

  static async extractUser(request: Request): Promise<AuthUser | null> {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;
    return await verifyToken(authHeader.slice(7));
  }
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/backend && bun run tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/plugins/AuthPlugin.ts
git commit -m "refactor(auth): verify local JWT instead of OIDC JWKS"
```

---

### Task 11: Register components & services in App.ts

**Files:**
- Modify: `apps/backend/src/App.ts`

- [ ] **Step 1: Add the component import**

After the existing component imports (after `import "./components/ProjectMembership";`), add:

```typescript
import "./components/UserComponents";
```

- [ ] **Step 2: Add the service imports**

After `import { PermissionRestService } from "./services/PermissionService";`, add:

```typescript
import AuthService from "./services/AuthService";
import UserService from "./services/UserService";
```

- [ ] **Step 3: Register the services**

In the constructor, after `ServiceRegistry.registerService(new PermissionRestService());`, add:

```typescript
    ServiceRegistry.registerService(new AuthService());
    ServiceRegistry.registerService(new UserService());
```

- [ ] **Step 4: Type-check**

Run: `cd apps/backend && bun run tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/App.ts
git commit -m "feat(users): register user components and services"
```

---

### Task 12: Point `utils/auth.ts` and `lib/auth-context.ts` at the local module

**Files:**
- Modify: `apps/backend/src/utils/auth.ts` (full rewrite)
- Modify: `apps/backend/src/lib/auth-context.ts` (full rewrite)

- [ ] **Step 1: Rewrite `utils/auth.ts`**

```typescript
// apps/backend/src/utils/auth.ts
export {
  requireUser,
  requirePermission,
  requireAdmin,
  hasPermission,
  Action,
  TasksResources,
  CoreResources,
  TASKS_PERMISSIONS,
  type AuthContext,
  type AuthUser,
  type PermissionEntry,
} from "~/auth";

import { requireUser, type AuthUser, type AuthContext } from "~/auth";
import { GraphQLError } from "graphql";
import { Query } from "bunsane/query";
import { ProjectMembershipData } from "~/components/ProjectMembership";

export function isAdmin(user: { isAdmin?: boolean; permissions?: string[] }): boolean {
  return user.isAdmin === true || (user.permissions?.includes("*") ?? false);
}

/** Check if user is a member of the given project. Admins bypass. */
export async function checkProjectMember(
  user: AuthUser,
  projectId: string,
): Promise<boolean> {
  if (isAdmin(user)) return true;
  const memberships = await new Query()
    .with(ProjectMembershipData, {
      filters: [
        Query.typedFilter(ProjectMembershipData, "projectId", "=", projectId),
        Query.typedFilter(ProjectMembershipData, "userId", "=", user.id),
      ],
    })
    .take(1)
    .exec();
  return memberships.length > 0;
}
```

Note: `requireAdmin` now comes from `~/auth` (Task 4) via the re-export above, so this file no longer defines it locally. Existing importers (`ProjectService` imports `requireAdmin` from `~/utils/auth`) keep working unchanged.

- [ ] **Step 2: Rewrite `lib/auth-context.ts`**

```typescript
// apps/backend/src/lib/auth-context.ts
export {
  hasPermission,
  requireUser as requireAuth,
  TasksResources,
  CoreResources,
  type AuthUser as TaskAuthUser,
  type AuthContext as TaskAuthContext,
} from "~/auth";

import { hasPermission, requireUser, type AuthContext } from "~/auth";

export function checkPermission(context: AuthContext, resource: string, action: string): boolean {
  const user = requireUser(context);
  return hasPermission(user.permissions ?? [], resource, action);
}
```

- [ ] **Step 3: Type-check**

Run: `cd apps/backend && bun run tsc --noEmit`
Expected: errors ONLY in files still using `user.sub` (fixed in Task 15) and `MembershipService`/`ProjectService` (Tasks 13–14). That is expected at this stage.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/utils/auth.ts apps/backend/src/lib/auth-context.ts
git commit -m "refactor(auth): route auth utils through local module"
```

---

### Task 13: Update PermissionService & MembershipService imports

**Files:**
- Modify: `apps/backend/src/services/PermissionService.ts`
- Modify: `apps/backend/src/services/MembershipService.ts:10`

- [ ] **Step 1: Fix PermissionService import**

In `apps/backend/src/services/PermissionService.ts`, change line 2 from:

```typescript
import { type PermissionManifest, TASKS_PERMISSIONS } from '@qyubit/sedjiwa-permissions';
```

to:

```typescript
import { type PermissionManifest, TASKS_PERMISSIONS } from '~/auth';
```

- [ ] **Step 2: Fix MembershipService import**

In `apps/backend/src/services/MembershipService.ts`, change line 10 from:

```typescript
import { hasPermission } from "@qyubit/sedjiwa-permissions";
```

to:

```typescript
import { hasPermission } from "~/auth";
```

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/services/PermissionService.ts apps/backend/src/services/MembershipService.ts
git commit -m "refactor(auth): use local module in permission/membership services"
```

---

### Task 14: Replace `fetchUserIdsByPermission` and delete oidc-client

**Files:**
- Create: `apps/backend/src/lib/user-directory.ts`
- Modify: `apps/backend/src/services/ProjectService.ts` (lines 33, 431–439)
- Delete: `apps/backend/src/lib/oidc-client.ts`

- [ ] **Step 1: Add a local helper**

```typescript
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
```

- [ ] **Step 2: Update ProjectService**

In `apps/backend/src/services/ProjectService.ts`, change the import on line 33 from:

```typescript
import { fetchUserIdsByPermission } from "~/lib/oidc-client";
```

to:

```typescript
import { listActiveUserIds } from "~/lib/user-directory";
```

Then replace the auto-membership block (around lines 431–439, which reads `const authToken = extractAuthToken(context.request); const userIds = await fetchUserIdsByPermission(TasksResources.Projects, Action.ReadAll, authToken);`) with:

```typescript
    // Auto-add all active users as members
    const userIds = await listActiveUserIds();
```

Leave the following `const memberIds = new Set(userIds); memberIds.add(user.id); ...` block intact (note `user.sub` → `user.id` handled in Task 15). If `extractAuthToken` becomes unused in this file after this change, remove its now-dead import line as well.

- [ ] **Step 3: Delete the OIDC client**

```bash
git rm apps/backend/src/lib/oidc-client.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/lib/user-directory.ts apps/backend/src/services/ProjectService.ts
git commit -m "refactor(projects): auto-add active local users instead of OIDC permission lookup"
```

---

### Task 15: Rename `user.sub` → `user.id` across services

**Files (42 occurrences):**
- Modify: `apps/backend/src/services/TaskService.ts` (12)
- Modify: `apps/backend/src/services/ProjectService.ts` (8)
- Modify: `apps/backend/src/services/CommentService.ts` (8)
- Modify: `apps/backend/src/services/PageService.ts` (5)
- Modify: `apps/backend/src/services/NotificationService.ts` (4)
- Modify: `apps/backend/src/services/DashboardService.ts` (1)
- Modify: `apps/backend/src/services/MembershipService.ts` (1)

- [ ] **Step 1: Replace all occurrences**

Run this from the repo root (safe: `user.sub` is only ever the auth-user identity here):

```bash
cd apps/backend && \
grep -rl "user\.sub" src/services | while read f; do
  sed -i 's/user\.sub/user.id/g' "$f"
done
grep -rn "user\.sub" src && echo "REMAINING (should be none above)" || echo "none remaining"
```

Expected: `none remaining`.

- [ ] **Step 2: Type-check the whole backend**

Run: `cd apps/backend && bun run tsc --noEmit`
Expected: PASS (0 errors). If any file still imports from `@qyubit/sedjiwa-permissions`, fix it to import from `~/auth`.

- [ ] **Step 3: Verify the package is fully unreferenced**

Run: `cd apps/backend && grep -rn "sedjiwa-permissions" src || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/services
git commit -m "refactor(auth): rename user.sub to user.id across services"
```

---

### Task 16: Remove the package dependency & update env

**Files:**
- Modify: `apps/backend/package.json`
- Modify: `apps/backend/.env.example`

- [ ] **Step 1: Remove the dependency**

In `apps/backend/package.json`, delete the line:

```json
    "@qyubit/sedjiwa-permissions": "0.3.3",
```

- [ ] **Step 2: Update env example**

In `apps/backend/.env.example`, remove the OIDC lines (`OIDC_ISSUER_URL`, `OIDC_API_URL`, `OIDC_AUDIENCE`) and add:

```bash
# Local auth (JWT)
AUTH_JWT_SECRET=change-me-to-a-long-random-string
AUTH_JWT_EXPIRES_IN=7d
```

- [ ] **Step 3: Reinstall & smoke-test the server boots**

Run:
```bash
cd apps/backend && bun install && AUTH_JWT_SECRET=test-secret timeout 8 bun run dev 2>&1 | head -40
```
Expected: server logs `[AuthPlugin] Local JWT auth enabled` and starts listening without errors (the `timeout` ends it).

- [ ] **Step 4: Run the full backend test suite**

Run: `cd apps/backend && bun test`
Expected: all Phase 1–3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/package.json apps/backend/.env.example apps/backend/bun.lock
git commit -m "chore(auth): drop sedjiwa-permissions dep, add AUTH_JWT env"
```

---

### Task 17: Seed script

**Files:**
- Create: `apps/backend/scripts/seed-users.ts`

- [ ] **Step 1: Write the seed script**

```typescript
// apps/backend/scripts/seed-users.ts
import "reflect-metadata";
import "~/components/UserComponents";
import { Entity } from "bunsane/core/Entity";
import { Query } from "bunsane/query";
import {
  PhoneComponent, PasswordComponent, UserProfileComponent, UserStatusComponent, UserTag, AdminTag,
} from "~/components/UserComponents";
import { hashPassword } from "~/lib/user-serializer";

const SEED = [
  { phone: "081200000001", password: "admin123", displayName: "Admin", isAdmin: true },
  { phone: "081200000002", password: "member123", displayName: "Budi Member", isAdmin: false },
  { phone: "081200000003", password: "member123", displayName: "Sari Member", isAdmin: false },
];

for (const u of SEED) {
  const existing = await new Query()
    .with(PhoneComponent, { filters: [Query.typedFilter(PhoneComponent, "value", "=", u.phone)] })
    .take(1)
    .exec();
  if (existing.length > 0) {
    console.log(`skip (exists): ${u.phone} ${u.displayName}`);
    continue;
  }
  const hash = await hashPassword(u.password);
  const entity = Entity.Create()
    .add(UserTag, {})
    .add(PhoneComponent, { value: u.phone, verified: true })
    .add(PasswordComponent, { hash, changedAt: new Date() })
    .add(UserProfileComponent, { displayName: u.displayName, avatarUrl: "", email: "" })
    .add(UserStatusComponent, { value: "active", createdAt: new Date(), lastLoginAt: null });
  if (u.isAdmin) entity.add(AdminTag, {});
  await entity.save();
  console.log(`created: ${u.phone} / ${u.password} — ${u.displayName}${u.isAdmin ? " (admin)" : ""}`);
}

console.log("Seed complete.");
process.exit(0);
```

- [ ] **Step 2: Run the seed (requires Postgres running)**

Run: `cd apps/backend && AUTH_JWT_SECRET=test-secret bun run scripts/seed-users.ts`
Expected: prints `created:` lines for 3 users, then `Seed complete.` Running it again prints `skip (exists)` for all 3 (idempotent).

- [ ] **Step 3: Commit**

```bash
git add apps/backend/scripts/seed-users.ts
git commit -m "feat(users): add idempotent user seed script"
```

---

### Task 18: Backend integration smoke test (register → approve → login → me)

**Files:** none (manual verification)

- [ ] **Step 1: Start the backend**

Run: `cd apps/backend && AUTH_JWT_SECRET=test-secret bun run dev` (leave running in one terminal; Postgres must be up).

- [ ] **Step 2: Log in as the seeded admin and call `me`**

```bash
ADMIN_TOKEN=$(curl -s localhost:3000/graphql -H 'Content-Type: application/json' \
  -d '{"query":"mutation{ login(phone:\"081200000001\",password:\"admin123\") }"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["login"]["token"])')
echo "token: ${ADMIN_TOKEN:0:20}..."
curl -s localhost:3000/graphql -H 'Content-Type: application/json' -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"query":"query{ me }"}'
```
Expected: `me` returns the admin `UserJSON` with `"isAdmin":true`.

- [ ] **Step 3: Register a pending user, confirm login is blocked, approve, then login succeeds**

```bash
curl -s localhost:3000/graphql -H 'Content-Type: application/json' \
  -d '{"query":"mutation{ register(phone:\"081299999999\",password:\"newpass1\",displayName:\"New User\") }"}'
# login should be blocked (pending):
curl -s localhost:3000/graphql -H 'Content-Type: application/json' \
  -d '{"query":"mutation{ login(phone:\"081299999999\",password:\"newpass1\") }"}'
# approve via admin listUsers + activateUser:
NEW_ID=$(curl -s localhost:3000/graphql -H 'Content-Type: application/json' -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"query":"query{ listUsers(status:\"pending\") }"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["listUsers"][0]["id"])')
curl -s localhost:3000/graphql -H 'Content-Type: application/json' -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d "{\"query\":\"mutation{ activateUser(id:\\\"$NEW_ID\\\") }\"}"
# now login works:
curl -s localhost:3000/graphql -H 'Content-Type: application/json' \
  -d '{"query":"mutation{ login(phone:\"081299999999\",password:\"newpass1\") }"}'
```
Expected: register returns a `pending` user; first login returns a `FORBIDDEN` "awaiting admin approval" error; after `activateUser`, login returns a token.

- [ ] **Step 4: No commit** (verification only). Stop the dev server.

---

## Phase 5 — Frontend

### Task 19: Auth store (Zustand) + login/register/me API

**Files:**
- Create: `apps/frontend/src/stores/auth-store.ts`

- [ ] **Step 1: Write the store**

```typescript
// apps/frontend/src/stores/auth-store.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { client, gql, setAuthToken } from "@/lib/graphql-client";

export interface AuthUser {
  id: string;
  phone: string;
  displayName: string;
  email: string;
  avatarUrl: string;
  isAdmin: boolean;
  status: "pending" | "active" | "suspended";
}

const LOGIN = gql`mutation Login($phone: String!, $password: String!) { login(phone: $phone, password: $password) }`;
const REGISTER = gql`mutation Register($phone: String!, $password: String!, $displayName: String!) { register(phone: $phone, password: $password, displayName: $displayName) }`;

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAdmin: boolean;
  login: (phone: string, password: string) => Promise<void>;
  register: (phone: string, password: string, displayName: string) => Promise<AuthUser>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAdmin: false,
      async login(phone, password) {
        const { data } = await client.mutate({ mutation: LOGIN, variables: { phone, password } });
        const { token, user } = data.login as { token: string; user: AuthUser };
        setAuthToken(token);
        set({ token, user, isAdmin: user.isAdmin });
      },
      async register(phone, password, displayName) {
        const { data } = await client.mutate({ mutation: REGISTER, variables: { phone, password, displayName } });
        return (data.register as { user: AuthUser }).user;
      },
      logout() {
        setAuthToken(null);
        set({ token: null, user: null, isAdmin: false });
      },
    }),
    {
      name: "task-auth",
      onRehydrateStorage: () => (state) => {
        if (state?.token) setAuthToken(state.token);
      },
    },
  ),
);
```

- [ ] **Step 2: Type-check**

Run: `cd apps/frontend && bun run tsc --noEmit`
Expected: PASS (errors elsewhere from still-present OIDC code are fixed in later tasks; this file alone must type-check).

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/stores/auth-store.ts
git commit -m "feat(auth): add local auth store"
```

---

### Task 20: Rewire `main.tsx` and `app.tsx`

**Files:**
- Modify: `apps/frontend/src/main.tsx`
- Modify: `apps/frontend/src/app.tsx`

- [ ] **Step 1: Rewrite `main.tsx`** (remove the OIDC provider)

```typescript
// apps/frontend/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 2: Rewrite `app.tsx`** (token now comes from the store, applied on rehydrate)

```typescript
// apps/frontend/src/app.tsx
import { RouterProvider } from "react-router";
import { ThemeProvider } from "next-themes";
import { ApolloProvider, client } from "@/lib/graphql-client";
import { Toaster } from "@/components/ui/sonner";
import { router } from "./router";

export function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <ApolloProvider client={client}>
        <RouterProvider router={router} />
        <Toaster />
      </ApolloProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/main.tsx apps/frontend/src/app.tsx
git commit -m "refactor(auth): remove OIDC provider from app root"
```

---

### Task 21: Login & register pages

**Files:**
- Create: `apps/frontend/src/pages/login.tsx`
- Create: `apps/frontend/src/pages/register.tsx`

- [ ] **Step 1: Write the login page**

```tsx
// apps/frontend/src/pages/login.tsx
import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function Component() {
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(phone, password);
      navigate(params.get("redirect") || "/dashboard", { replace: true });
    } catch (err) {
      setError((err as Error).message.replace(/^.*?: /, ""));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl border p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone number</Label>
          <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
        <p className="text-center text-sm text-muted-foreground">
          No account? <Link to="/register" className="underline">Register</Link>
        </p>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Write the register page**

```tsx
// apps/frontend/src/pages/register.tsx
import { useState } from "react";
import { Link } from "react-router";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function Component() {
  const register = useAuthStore((s) => s.register);
  const [phone, setPhone] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(phone, password, displayName);
      setDone(true);
    } catch (err) {
      setError((err as Error).message.replace(/^.*?: /, ""));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-3 rounded-xl border p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold">Registration received</h1>
          <p className="text-sm text-muted-foreground">Your account is awaiting admin approval. You'll be able to sign in once it's activated.</p>
          <Link to="/login" className="text-sm underline">Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl border p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Create account</h1>
        <div className="space-y-2">
          <Label htmlFor="displayName">Name</Label>
          <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone number</Label>
          <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={6} required />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Submitting…" : "Register"}</Button>
        <p className="text-center text-sm text-muted-foreground">
          Have an account? <Link to="/login" className="underline">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
```

Note: verify `@/components/ui/{button,input,label}` exist (they are shadcn/ui primitives already used in the project). If `label` is missing, run `bunx shadcn@latest add label` from `apps/frontend`.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/pages/login.tsx apps/frontend/src/pages/register.tsx
git commit -m "feat(auth): add login and register pages"
```

---

### Task 22: Router — local auth gating + routes

**Files:**
- Modify: `apps/frontend/src/router.tsx`
- Delete: `apps/frontend/src/pages/callback.tsx`

- [ ] **Step 1: Rewrite `router.tsx`** (`AuthenticatedLayout` reads the store; add `/login`, `/register`, `/admin/users`; drop `/callback`)

```tsx
// apps/frontend/src/router.tsx
import { createBrowserRouter, Outlet, Navigate, useLocation } from "react-router";
import { useAuthStore } from "@/stores/auth-store";
import { AppLayout } from "@/components/layout/app-layout";

function RootLayout() {
  return <Outlet />;
}

function NotFound() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold">404</h1>
        <p className="mt-2 text-muted-foreground">Page not found</p>
      </div>
    </div>
  );
}

function AuthenticatedLayout() {
  const token = useAuthStore((s) => s.token);
  const location = useLocation();
  if (!token) {
    return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}

function AdminOnly() {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: RootLayout,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: "login", lazy: () => import("./pages/login") },
      { path: "register", lazy: () => import("./pages/register") },
      { path: "logout", lazy: () => import("./pages/logout") },
      {
        Component: AuthenticatedLayout,
        children: [
          { path: "dashboard", lazy: () => import("./pages/dashboard") },
          { path: "my-tasks", lazy: () => import("./pages/my-tasks") },
          { path: "tasks-by-me", lazy: () => import("./pages/tasks-by-me") },
          { path: "settings", lazy: () => import("./pages/settings") },
          { path: "projects", lazy: () => import("./pages/projects") },
          {
            Component: AdminOnly,
            children: [
              { path: "admin/users", lazy: () => import("./pages/admin-users") },
            ],
          },
          {
            path: "projects/:projectId",
            lazy: () => import("./pages/project-layout"),
            children: [
              { index: true, element: <Navigate to="all-tasks" replace /> },
              { path: "all-tasks", lazy: () => import("./pages/project-detail") },
              { path: "sub-projects", lazy: () => import("./pages/project-sub-projects") },
              { path: "members", lazy: () => import("./pages/project-members") },
              { path: "media", lazy: () => import("./pages/media") },
              { path: "timeline", lazy: () => import("./pages/timeline") },
              { path: "pages", lazy: () => import("./pages/pages-list") },
              { path: "pages/:pageId", lazy: () => import("./pages/page-editor") },
            ],
          },
        ],
      },
      { path: "*", Component: NotFound },
    ],
  },
]);
```

Note: pages loaded via `lazy` must export a `Component` (React Router v7 convention). The `login`/`register`/`admin-users` pages in this plan already export `Component`. Existing pages already follow this.

- [ ] **Step 2: Delete the OIDC callback page**

```bash
git rm apps/frontend/src/pages/callback.tsx
```

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/router.tsx
git commit -m "refactor(auth): gate routes on local auth store"
```

---

### Task 23: Rewrite `logout.tsx` and `landing.tsx`

**Files:**
- Modify: `apps/frontend/src/pages/logout.tsx`
- Modify: `apps/frontend/src/pages/landing.tsx`

- [ ] **Step 1: Rewrite `logout.tsx`**

```tsx
// apps/frontend/src/pages/logout.tsx
import { useEffect } from "react";
import { Navigate } from "react-router";
import { useAuthStore } from "@/stores/auth-store";

export function Component() {
  const logout = useAuthStore((s) => s.logout);
  useEffect(() => { logout(); }, [logout]);
  return <Navigate to="/login" replace />;
}
```

- [ ] **Step 2: Rewrite `landing.tsx`** (no OIDC; just redirect based on auth)

```tsx
// apps/frontend/src/pages/landing.tsx
import { Navigate } from "react-router";
import { useAuthStore } from "@/stores/auth-store";

export function Component() {
  const token = useAuthStore((s) => s.token);
  return <Navigate to={token ? "/dashboard" : "/login"} replace />;
}
```

Note: `landing` is no longer referenced by the router (index redirects to `/dashboard`), but keep it valid so any lingering imports still compile.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/pages/logout.tsx apps/frontend/src/pages/landing.tsx
git commit -m "refactor(auth): local logout and landing redirects"
```

---

### Task 24: Rewrite `use-me.ts` (local `me`, local admin checks)

**Files:**
- Modify: `apps/frontend/src/hooks/use-me.ts` (full rewrite)

- [ ] **Step 1: Rewrite the hook**

```typescript
// apps/frontend/src/hooks/use-me.ts
import { useQuery, gql } from "@/lib/graphql-client";
import { useAuthStore } from "@/stores/auth-store";

const ME_QUERY = gql`query Me { me }`;

export interface MeData {
  id: string;
  profile: { displayName: string };
  role: "manager" | "member";
  isAdmin: boolean;
}

interface MeResponse {
  me: {
    id: string;
    displayName: string;
    isAdmin: boolean;
  } | null;
}

export function useMe() {
  const { data, loading, error } = useQuery<MeResponse>(ME_QUERY, {
    fetchPolicy: "cache-and-network",
  });

  const meData: MeData | null = data?.me
    ? {
        id: data.me.id,
        profile: { displayName: data.me.displayName },
        role: data.me.isAdmin ? "manager" : "member",
        isAdmin: data.me.isAdmin,
      }
    : null;

  return { data: meData, isLoading: loading, error: error ?? null };
}

export function useIsManager(): boolean {
  return useAuthStore((s) => s.isAdmin);
}

export function useIsAdmin(): boolean {
  return useAuthStore((s) => s.isAdmin);
}

export function useHasPermission(_resource: string, _action: string): boolean {
  // Local model collapses to admin vs member: admins can do everything.
  return useAuthStore((s) => s.isAdmin);
}
```

Note: `me` is now on the default (tasks) client — no `client: oidcClient` option. This removes the last frontend dependency on `oidcClient` for identity.

- [ ] **Step 2: Type-check**

Run: `cd apps/frontend && bun run tsc --noEmit`
Expected: PASS for this file (remaining errors are in `use-users.ts` and OIDC-referencing components, fixed next).

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/hooks/use-me.ts
git commit -m "refactor(auth): local me + admin checks"
```

---

### Task 25: Rewrite `use-users.ts` (local directory)

**Files:**
- Modify: `apps/frontend/src/hooks/use-users.ts` (full rewrite)

- [ ] **Step 1: Rewrite the hook** (query the local tasks endpoint; keep the exported `User` shape)

```typescript
// apps/frontend/src/hooks/use-users.ts
import { useQuery, gql } from "@/lib/graphql-client";
import type { User } from "@/types/task";

const SEARCH_USERS = gql`query SearchUsers($q: String) { searchUsers(q: $q) }`;
const GET_USER = gql`query GetUser($id: String!) { getUser(id: $id) }`;

interface LocalUserResponse {
  id: string;
  displayName: string;
  email: string;
  avatarUrl: string;
}

function mapLocalUser(raw: LocalUserResponse): User {
  return {
    id: raw.id,
    externalId: raw.id,
    email: raw.email,
    name: raw.displayName,
    avatarUrl: raw.avatarUrl || undefined,
  };
}

export function useSearchUsers(query: string) {
  const { data, loading, error } = useQuery<{ searchUsers: LocalUserResponse[] }>(SEARCH_USERS, {
    variables: { q: query },
  });
  return {
    data: data?.searchUsers.map(mapLocalUser),
    isLoading: loading,
    error: error ?? null,
  };
}

export function useUser(id: string | undefined) {
  const { data, loading, error } = useQuery<{ getUser: LocalUserResponse | null }>(GET_USER, {
    variables: { id },
    skip: !id,
  });
  return {
    data: data?.getUser ? mapLocalUser(data.getUser) : undefined,
    isLoading: loading,
    error: error ?? null,
  };
}

export { SEARCH_USERS, type LocalUserResponse, mapLocalUser };
```

Note: `useSearchUsers` no longer skips on empty query (the local `searchUsers` returns all active users when `q` is blank, which is the desired directory behavior). If any consumer imported `CoreUserResponse`/`mapCoreUser` by name, update those imports to `LocalUserResponse`/`mapLocalUser` (search: `grep -rn "CoreUserResponse\|mapCoreUser" apps/frontend/src`).

- [ ] **Step 2: Fix any broken importers**

Run: `cd apps/frontend && grep -rn "CoreUserResponse\|mapCoreUser" src`
For each hit, replace with `LocalUserResponse` / `mapLocalUser`.

- [ ] **Step 3: Type-check**

Run: `cd apps/frontend && bun run tsc --noEmit`
Expected: PASS for these files (OIDC-component errors remain until Task 26).

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/hooks/use-users.ts
git commit -m "refactor(users): local user directory hook"
```

---

### Task 26: Purge remaining `react-oidc-context` usage in components

**Files (from grep in this plan's research):**
- Modify: `apps/frontend/src/components/layout/app-sidebar.tsx`
- Modify: `apps/frontend/src/components/layout/company-initializer.tsx`
- Modify: `apps/frontend/src/components/tasks/task-activity-timeline.tsx`
- Modify: `apps/frontend/src/components/tasks/task-comments.tsx`

- [ ] **Step 1: Find every remaining `useAuth` / `react-oidc-context` reference**

Run: `cd apps/frontend && grep -rn "react-oidc-context\|useAuth(" src`
Expected hits: the four component files above (plus none in `app.tsx`/`router.tsx`/`main.tsx`, already handled).

- [ ] **Step 2: Replace each usage**

For each file, remove `import { useAuth } from "react-oidc-context";` and replace the values read from `auth`:
- `auth.user?.profile?.sub` or the current user id → `useAuthStore((s) => s.user?.id)`
- `auth.user?.profile?.name` / display name → `useAuthStore((s) => s.user?.displayName)`
- `auth.isAuthenticated` → `useAuthStore((s) => !!s.token)`
- `auth.removeUser()` / `auth.signoutRedirect()` (logout) → `useAuthStore((s) => s.logout)()` then navigate to `/login`

Add `import { useAuthStore } from "@/stores/auth-store";` where needed. Inspect each file's actual usage and map the specific fields (they only use the current-user id and display name for activity/comments, and auth state for the sidebar).

- [ ] **Step 3: Type-check the whole frontend**

Run: `cd apps/frontend && bun run tsc --noEmit`
Expected: PASS (0 errors).

- [ ] **Step 4: Verify no OIDC references remain**

Run: `cd apps/frontend && grep -rn "react-oidc-context\|oidc-client-ts\|oidcClient\|oidc-config" src || echo "clean"`
Expected: `clean` (or only the `oidcClient` export line in `graphql-client.ts`, which is removed in Task 28).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components
git commit -m "refactor(auth): replace react-oidc-context usage with auth store"
```

---

### Task 27: Admin Users page + hooks

**Files:**
- Create: `apps/frontend/src/hooks/use-admin-users.ts`
- Create: `apps/frontend/src/pages/admin-users.tsx`

- [ ] **Step 1: Write the admin hooks**

```typescript
// apps/frontend/src/hooks/use-admin-users.ts
import { useQuery, useMutation, gql } from "@/lib/graphql-client";

export interface AdminUser {
  id: string;
  phone: string;
  displayName: string;
  email: string;
  avatarUrl: string;
  isAdmin: boolean;
  status: "pending" | "active" | "suspended";
  createdAt: string | null;
  lastLoginAt: string | null;
}

const LIST_USERS = gql`query ListUsers($status: String) { listUsers(status: $status) }`;
const CREATE_USER = gql`mutation CreateUser($phone: String!, $password: String!, $displayName: String!, $isAdmin: Boolean) { createUser(phone: $phone, password: $password, displayName: $displayName, isAdmin: $isAdmin) }`;
const ACTIVATE_USER = gql`mutation ActivateUser($id: String!) { activateUser(id: $id) }`;
const SUSPEND_USER = gql`mutation SuspendUser($id: String!) { suspendUser(id: $id) }`;
const SET_ADMIN = gql`mutation SetAdmin($id: String!, $isAdmin: Boolean!) { setAdmin(id: $id, isAdmin: $isAdmin) }`;
const RESET_PASSWORD = gql`mutation ResetPassword($id: String!, $newPassword: String!) { resetPassword(id: $id, newPassword: $newPassword) }`;
const DELETE_USER = gql`mutation DeleteUser($id: String!) { deleteUser(id: $id) }`;

export function useAdminUsers(status?: string) {
  const { data, loading, error, refetch } = useQuery<{ listUsers: AdminUser[] }>(LIST_USERS, {
    variables: { status },
    fetchPolicy: "cache-and-network",
  });
  return { users: data?.listUsers ?? [], isLoading: loading, error: error ?? null, refetch };
}

export function useUserAdminActions() {
  const [createUser] = useMutation(CREATE_USER);
  const [activateUser] = useMutation(ACTIVATE_USER);
  const [suspendUser] = useMutation(SUSPEND_USER);
  const [setAdmin] = useMutation(SET_ADMIN);
  const [resetPassword] = useMutation(RESET_PASSWORD);
  const [deleteUser] = useMutation(DELETE_USER);
  return { createUser, activateUser, suspendUser, setAdmin, resetPassword, deleteUser };
}
```

- [ ] **Step 2: Write the admin page**

```tsx
// apps/frontend/src/pages/admin-users.tsx
import { useState } from "react";
import { toast } from "sonner";
import { useAdminUsers, useUserAdminActions, type AdminUser } from "@/hooks/use-admin-users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function Component() {
  const { users, isLoading, refetch } = useAdminUsers();
  const actions = useUserAdminActions();
  const [form, setForm] = useState({ phone: "", displayName: "", password: "" });

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      await refetch();
      toast.success(ok);
    } catch (e) {
      toast.error((e as Error).message.replace(/^.*?: /, ""));
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    await run(
      () => actions.createUser({ variables: { ...form, isAdmin: false } }),
      "User created",
    );
    setForm({ phone: "", displayName: "", password: "" });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">Approve, suspend, and manage member accounts.</p>
      </div>

      <form onSubmit={onCreate} className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
        <div className="space-y-1">
          <Label htmlFor="c-name">Name</Label>
          <Input id="c-name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="c-phone">Phone</Label>
          <Input id="c-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="c-pass">Password</Label>
          <Input id="c-pass" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={6} required />
        </div>
        <Button type="submit">Add user</Button>
      </form>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-3">Name</th><th className="p-3">Phone</th><th className="p-3">Status</th><th className="p-3">Admin</th><th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u: AdminUser) => (
                <tr key={u.id} className="border-t">
                  <td className="p-3">{u.displayName}</td>
                  <td className="p-3">{u.phone}</td>
                  <td className="p-3 capitalize">{u.status}</td>
                  <td className="p-3">{u.isAdmin ? "Yes" : "No"}</td>
                  <td className="flex flex-wrap gap-2 p-3">
                    {u.status !== "active" && (
                      <Button size="sm" variant="outline" onClick={() => run(() => actions.activateUser({ variables: { id: u.id } }), "Activated")}>Approve</Button>
                    )}
                    {u.status === "active" && (
                      <Button size="sm" variant="outline" onClick={() => run(() => actions.suspendUser({ variables: { id: u.id } }), "Suspended")}>Suspend</Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => run(() => actions.setAdmin({ variables: { id: u.id, isAdmin: !u.isAdmin } }), "Updated")}>{u.isAdmin ? "Revoke admin" : "Make admin"}</Button>
                    <Button size="sm" variant="destructive" onClick={() => run(() => actions.deleteUser({ variables: { id: u.id } }), "Deleted")}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

Note: this page is routed at `/admin/users` behind the `AdminOnly` guard (Task 22). Add a sidebar link to it if desired (optional; inspect `app-sidebar.tsx` and mirror an existing nav item, gating on `useAuthStore((s) => s.isAdmin)`).

- [ ] **Step 3: Type-check**

Run: `cd apps/frontend && bun run tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/hooks/use-admin-users.ts apps/frontend/src/pages/admin-users.tsx
git commit -m "feat(users): admin users management page"
```

---

### Task 28: Remove OIDC deps, config, and dead clients

**Files:**
- Modify: `apps/frontend/package.json`
- Delete: `apps/frontend/src/lib/oidc-config.ts`
- Modify: `apps/frontend/src/lib/graphql-client.ts` (remove `oidcClient` + `OIDC_URL` if unused)

- [ ] **Step 1: Confirm `oidcClient` is unused**

Run: `cd apps/frontend && grep -rn "oidcClient\|OIDC_URL" src | grep -v "lib/graphql-client.ts"`
Expected: no hits. (If any remain, they were missed in Task 24/26 — fix them first.)

- [ ] **Step 2: Remove the OIDC client export**

In `apps/frontend/src/lib/graphql-client.ts`, delete the `export const oidcClient = makeClient(OIDC_URL);` line and the `export const OIDC_URL = ...;` line.

- [ ] **Step 3: Delete the OIDC config**

```bash
git rm apps/frontend/src/lib/oidc-config.ts
```

- [ ] **Step 4: Remove the npm dependencies**

In `apps/frontend/package.json`, delete the `"oidc-client-ts"` and `"react-oidc-context"` dependency lines. Then:

```bash
cd apps/frontend && bun install
```

- [ ] **Step 5: Type-check + build**

Run: `cd apps/frontend && bun run tsc --noEmit && bun run build`
Expected: both PASS.

- [ ] **Step 6: Verify a fully clean tree**

Run: `cd apps/frontend && grep -rn "oidc" src || echo "clean"`
Expected: `clean`.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/package.json apps/frontend/src/lib/graphql-client.ts apps/frontend/bun.lock
git commit -m "chore(auth): remove OIDC client deps and config"
```

---

### Task 29: End-to-end manual verification

**Files:** none (manual verification)

- [ ] **Step 1: Start backend + frontend**

Backend: `cd apps/backend && AUTH_JWT_SECRET=dev-secret bun run dev` (Postgres up; seed run once).
Frontend: `cd apps/frontend && bun run dev` (serves `:3001`).

- [ ] **Step 2: Verify the flows in the browser**

1. Visit `http://localhost:3001/` → redirected to `/login`.
2. Sign in with `081200000001` / `admin123` → lands on `/dashboard`.
3. Open `/admin/users` → seeded users listed. Create a user; it appears as `active`.
4. In an incognito window, `/register` a new user → "awaiting approval"; logging in as that user is rejected.
5. Back as admin, Approve the pending user; that user can now sign in.
6. Assign a task to a member (user directory works via `searchUsers`), add a comment (author id/name resolve from the store).
7. Sign out → redirected to `/login`; the token is cleared from localStorage.

- [ ] **Step 3: Confirm no OIDC network calls**

In the browser devtools Network tab during login/usage, confirm there are no requests to `/api/oidc/*` or `:4000`. Auth traffic goes only to the tasks GraphQL endpoint.

- [ ] **Step 4: Final commit (docs, if any tweaks were needed)** — otherwise none.

---

## Out of Scope (do not implement here)

- Core/Media/Sales cross-service calls (`use-leads`, `use-companies`, `use-divisions`, `use-media`, `use-media-project`, `approve-lead-dialog`, `project-form`, `comment-editor`, `project-layout`) still send the local token to services that expect the OIDC token; some of those features may error. This is accepted per the design decision "Focus Users/auth first" and will be handled separately.
- Full RBAC roles/permissions management UI.

## Self-Review Notes

- **Spec coverage:** local auth module (Tasks 1–4), User ECS (5–6), AuthService/UserService (7–9), AuthPlugin/App wiring (10–11), identity refactor + package removal (12–16), seed (17), frontend auth store/pages/router/hooks/admin (19–28), verification (18, 29). Registration=pending→approval enforced in Task 8 `login` + Task 27 approve UI. `user.sub`→`user.id` in Task 15. `fetchUserIdsByPermission` replaced in Task 14.
- **Type consistency:** `AuthUser`/`UserJSON` defined once (Tasks 1, 7) and reused; `signToken(AuthUser)`/`verifyToken→AuthUser`; `serializeUser`/`toAuthUser` names stable across services and seed.
