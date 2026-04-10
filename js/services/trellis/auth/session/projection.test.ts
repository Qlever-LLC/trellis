import { assertEquals } from "@std/assert";
import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";
import { isErr, Result, UnexpectedError } from "@qlever-llc/result";

import type { UserProjectionEntry } from "../../state/schemas.ts";
import { type UserProjectionKV, upsertUserProjection } from "./projection.ts";

class InMemoryKV<V> {
  #store = new Map<string, V>();

  seed(key: string, value: V): void {
    this.#store.set(key, value);
  }

  getValue(key: string): V | undefined {
    return this.#store.get(key);
  }

  async get(key: string): Promise<Result<{ value: V }, UnexpectedError>> {
    const value = this.#store.get(key);
    if (value === undefined) {
      return Result.err(new UnexpectedError({ context: { key } }));
    }
    return Result.ok({ value });
  }

  async put(key: string, value: V): Promise<Result<void, UnexpectedError>> {
    this.#store.set(key, value);
    return Result.ok(undefined);
  }
}

Deno.test("upsertUserProjection creates a new user projection", async () => {
  const usersKV = new InMemoryKV<UserProjectionEntry>();
  const trellisId = await trellisIdFromOriginId("github", "123");

  const result = await upsertUserProjection(usersKV as UserProjectionKV, {
    origin: "github",
    id: "123",
    name: "Alice",
    email: "alice@example.com",
    active: true,
    capabilities: [],
  });
  const value = result.take();
  if (isErr(value)) throw value.error;

  assertEquals(usersKV.getValue(trellisId), {
    origin: "github",
    id: "123",
    name: "Alice",
    email: "alice@example.com",
    active: true,
    capabilities: [],
  });
});

Deno.test("upsertUserProjection preserves admin-managed state when reprovisioning", async () => {
  const usersKV = new InMemoryKV<UserProjectionEntry>();
  const trellisId = await trellisIdFromOriginId("github", "123");
  usersKV.seed(trellisId, {
    origin: "github",
    id: "123",
    name: "Old Name",
    email: "old@example.com",
    active: false,
    capabilities: ["admin"],
  });

  const result = await upsertUserProjection(usersKV as UserProjectionKV, {
    origin: "github",
    id: "123",
    name: "New Name",
    email: "new@example.com",
    active: true,
    capabilities: [],
  });
  const value = result.take();
  if (isErr(value)) throw value.error;

  assertEquals(usersKV.getValue(trellisId), {
    origin: "github",
    id: "123",
    name: "New Name",
    email: "new@example.com",
    active: false,
    capabilities: ["admin"],
  });
});
