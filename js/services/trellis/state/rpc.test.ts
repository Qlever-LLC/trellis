import { assertEquals, assertRejects } from "@std/assert";
import type { BaseError, Result } from "@qlever-llc/result";

import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";
import { AuthError } from "@qlever-llc/trellis";

import { createStateHandlers } from "./rpc.ts";
import { StateStore } from "./storage.ts";
import {
  FakeSessionKV,
  FakeStateKV,
  makeDeviceSession,
  makeUserSession,
} from "./test_helpers.ts";

function unwrapOk<T, E extends BaseError>(value: Result<T, E>): T {
  if (value.isErr()) throw value.error;
  return value.unwrapOrElse((error) => {
    throw error;
  });
}

Deno.test("State RPC isolates userApp state by contract id", async () => {
  const sessionKV = new FakeSessionKV();
  const state = new StateStore({ kv: new FakeStateKV(), now: () => new Date("2026-01-01T00:00:00.000Z") });
  const handlers = createStateHandlers({ sessionKV, state });

  sessionKV.seed("session-one.user-1", makeUserSession({ trellisId: "user-1", contractId: "acme.notes@v1" }));
  sessionKV.seed("session-two.user-1", makeUserSession({ trellisId: "user-1", contractId: "acme.tasks@v1" }));

  await handlers.put(
    { scope: "userApp", key: "draft", value: { text: "hello" } },
    { caller: { type: "user", origin: "github", id: "123" }, sessionKey: "session-one" },
  );

  const own = unwrapOk(await handlers.get(
    { scope: "userApp", key: "draft" },
    { caller: { type: "user", origin: "github", id: "123" }, sessionKey: "session-one" },
  ));
  assertEquals(own.found, true);

  const other = unwrapOk(await handlers.get(
    { scope: "userApp", key: "draft" },
    { caller: { type: "user", origin: "github", id: "123" }, sessionKey: "session-two" },
  ));
  assertEquals(other, { found: false });
});

Deno.test("State RPC restricts deviceApp access to device sessions", async () => {
  const sessionKV = new FakeSessionKV();
  const state = new StateStore({ kv: new FakeStateKV(), now: () => new Date("2026-01-01T00:00:00.000Z") });
  const handlers = createStateHandlers({ sessionKV, state });

  sessionKV.seed("device-session.device-1", makeDeviceSession({ deviceId: "device-1", contractId: "acme.reader@v1" }));
  sessionKV.seed("user-session.user-1", makeUserSession({ trellisId: "user-1", contractId: "acme.reader@v1" }));

  const written = unwrapOk(await handlers.put(
    { scope: "deviceApp", key: "prefs", value: { page: 1 } },
    { caller: { type: "device", id: "device-1" }, sessionKey: "device-session" },
  ));
  assertEquals(written.entry.key, "prefs");

  await assertRejects(
    () => handlers.get(
      { scope: "deviceApp", key: "prefs" },
      { caller: { type: "user", origin: "github", id: "123" }, sessionKey: "user-session" },
    ),
    AuthError,
  );
});

Deno.test("State admin RPCs inspect and delete user state", async () => {
  const sessionKV = new FakeSessionKV();
  const state = new StateStore({ kv: new FakeStateKV(), now: () => new Date("2026-01-01T00:00:00.000Z") });
  const handlers = createStateHandlers({ sessionKV, state });
  const trellisId = await trellisIdFromOriginId("github", "123");

  sessionKV.seed("session-one.user-1", makeUserSession({ trellisId, contractId: "acme.notes@v1" }));

  const put = unwrapOk(await handlers.put(
    { scope: "userApp", key: "draft", value: { text: "hello" } },
    { caller: { type: "user", origin: "github", id: "123" }, sessionKey: "session-one" },
  ));

  const adminCaller = { caller: { type: "user", capabilities: ["admin"] } };
  const target = {
    scope: "userApp" as const,
    contractId: "acme.notes@v1",
    user: { origin: "github", id: "123" },
  };

  const got = unwrapOk(await handlers.adminGet({ ...target, key: "draft" }, adminCaller));
  assertEquals(got.found, true);

  const listed = unwrapOk(await handlers.adminList({ ...target, offset: 0, limit: 10 }, adminCaller));
  assertEquals(listed.entries.map((entry) => entry.key), ["draft"]);

  const deleted = unwrapOk(await handlers.adminDelete(
    { ...target, key: "draft", expectedRevision: put.entry.revision },
    adminCaller,
  ));
  assertEquals(deleted, { deleted: true });

  const missing = unwrapOk(await handlers.adminGet({ ...target, key: "draft" }, adminCaller));
  assertEquals(missing, { found: false });
});
