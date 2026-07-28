// apps/backend/src/lib/user-serializer.test.ts
import { expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "./user-serializer";

test("hashPassword + verifyPassword round-trip", async () => {
  const hash = await hashPassword("s3cret");
  expect(hash).not.toBe("s3cret");
  expect(await verifyPassword("s3cret", hash)).toBe(true);
  expect(await verifyPassword("wrong", hash)).toBe(false);
});
