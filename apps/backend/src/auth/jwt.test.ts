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
