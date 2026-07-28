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
