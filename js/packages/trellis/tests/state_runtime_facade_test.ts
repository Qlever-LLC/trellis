import { assertEquals } from "@std/assert";
import { ValidationError } from "../index.ts";
import { Type } from "typebox";

import { createClient } from "../client.ts";
import { defineAppContract } from "../contract.ts";

Deno.test("connected runtime exposes typed named state stores", async () => {
  const contract = defineAppContract(
    {
      schemas: {
        Preferences: Type.Object({ theme: Type.String() }),
        Draft: Type.Object({ title: Type.String() }),
      },
    },
    (ref) => ({
      id: "acme.state-runtime@v1",
      displayName: "State Runtime",
      description: "Exercise the connected state facade.",
      state: {
        preferences: { kind: "value", schema: ref.schema("Preferences") },
        drafts: { kind: "map", schema: ref.schema("Draft") },
      },
    }),
  );

  const trellis = createClient(
    contract,
    { options: { inboxPrefix: "_INBOX.test" } } as never,
    { sessionKey: "test", sign: () => new Uint8Array(64) },
  );

  const calls: Array<{ method: string; input: unknown }> = [];
  const nats = Reflect.get(trellis, "nats") as {
    request(subject: string, payload: string): Promise<{
      json(): unknown;
      headers?: { get(name: string): string | null | undefined };
    }>;
  };
  nats.request = async (subject: string, payload: string) => {
    const input = JSON.parse(payload) as { key?: string; value?: unknown };
    const method = subject === "rpc.v1.State.Get"
      ? "State.Get"
      : subject === "rpc.v1.State.Put"
      ? "State.Put"
      : subject === "rpc.v1.State.List"
      ? "State.List"
      : "State.Delete";
    calls.push({ method, input });

    const body = method === "State.Get"
      ? {
        found: true,
        entry: {
          value: { theme: "dark" },
          revision: "1",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }
      : method === "State.List"
      ? {
        entries: [{
          key: "open/one",
          value: { title: "Draft" },
          revision: "2",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }],
        count: 1,
        offset: 0,
        limit: 100,
      }
      : method === "State.Put"
      ? {
        applied: true,
        entry: {
          ...(typeof input.key === "string" ? { key: input.key } : {}),
          value: input.value ?? null,
          revision: "3",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }
      : { deleted: true };

    return {
      json: () => body,
      headers: { get: () => undefined },
    };
  };

  const preferencesResult = await trellis.state.preferences.get();
  if (preferencesResult.isErr()) throw preferencesResult.error;
  const preferences = preferencesResult.unwrapOrElse(() => {
    throw new Error("expected preferences result");
  });
  if ("migrationRequired" in preferences || !preferences.found) {
    throw new Error("expected preferences entry");
  }
  assertEquals(preferences.entry.value.theme, "dark");

  const writtenResult = await trellis.state.preferences.put(
    { theme: "light" },
    {
      expectedRevision: null,
    },
  );
  if (writtenResult.isErr()) throw writtenResult.error;
  const written = writtenResult.unwrapOrElse(() => {
    throw new Error("expected put result");
  });
  assertEquals(written.applied, true);

  const prefixedDrafts = trellis.state.drafts.prefix("inspection/active");
  const draftResult = await prefixedDrafts.put("open", { title: "Draft" }, {
    expectedRevision: "2",
  });
  if (draftResult.isErr()) throw draftResult.error;
  const draft = draftResult.unwrapOrElse(() => {
    throw new Error("expected map put result");
  });
  assertEquals(draft.applied, true);

  const listedResult = await prefixedDrafts.list();
  if (listedResult.isErr()) throw listedResult.error;
  const listed = listedResult.unwrapOrElse(() => {
    throw new Error("expected list result");
  });
  const listedEntry = listed.entries[0];
  if (!listedEntry || "migrationRequired" in listedEntry) {
    throw new Error("expected listed state entry");
  }
  assertEquals(listedEntry.value.title, "Draft");

  await trellis.state.preferences.delete();
  await prefixedDrafts.delete("open", { expectedRevision: "3" });

  assertEquals(calls, [
    { method: "State.Get", input: { store: "preferences" } },
    {
      method: "State.Put",
      input: {
        store: "preferences",
        value: { theme: "light" },
        expectedRevision: null,
      },
    },
    {
      method: "State.Put",
      input: {
        store: "drafts",
        key: "inspection/active/open",
        value: { title: "Draft" },
        expectedRevision: "2",
      },
    },
    {
      method: "State.List",
      input: {
        store: "drafts",
        prefix: "inspection/active",
        offset: 0,
        limit: 100,
      },
    },
    { method: "State.Delete", input: { store: "preferences" } },
    {
      method: "State.Delete",
      input: {
        store: "drafts",
        key: "inspection/active/open",
        expectedRevision: "3",
      },
    },
  ]);
});

Deno.test("connected runtime validates store-specific state writes before request", async () => {
  const contract = defineAppContract(
    {
      schemas: {
        Preferences: Type.Object({ theme: Type.String() }),
      },
    },
    (ref) => ({
      id: "acme.state-runtime-validation@v1",
      displayName: "State Runtime Validation",
      description: "Exercise facade validation.",
      state: {
        preferences: { kind: "value", schema: ref.schema("Preferences") },
      },
    }),
  );

  const trellis = createClient(
    contract,
    { options: { inboxPrefix: "_INBOX.test" } } as never,
    { sessionKey: "test", sign: () => new Uint8Array(64) },
  );

  let requestCount = 0;
  const nats = Reflect.get(trellis, "nats") as {
    request(): Promise<
      {
        json(): unknown;
        headers?: { get(name: string): string | null | undefined };
      }
    >;
  };
  nats.request = async () => {
    requestCount += 1;
    return {
      json: () => ({
        applied: true,
        entry: {
          value: { theme: "dark" },
          revision: "1",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
      headers: { get: () => undefined },
    };
  };

  const preferencesStore = Reflect.get(trellis.state, "preferences");
  if (!preferencesStore || typeof preferencesStore !== "object") {
    throw new Error("expected preferences store client");
  }
  const put = Reflect.get(preferencesStore, "put");
  if (typeof put !== "function") {
    throw new Error("expected preferences put helper");
  }

  const result = await Reflect.apply(put, preferencesStore, [{ theme: 123 }]);
  assertEquals(result.isErr(), true);
  if (result.isOk()) throw new Error("expected validation error");
  assertEquals(result.error instanceof ValidationError, true);
  assertEquals(requestCount, 0);
});

Deno.test("connected runtime validates store-specific state reads after response parsing", async () => {
  const contract = defineAppContract(
    {
      schemas: {
        Preferences: Type.Object({ theme: Type.String() }),
        Draft: Type.Object({ title: Type.String() }),
      },
    },
    (ref) => ({
      id: "acme.state-runtime-read-validation@v1",
      displayName: "State Runtime Read Validation",
      description: "Exercise facade response validation.",
      state: {
        preferences: { kind: "value", schema: ref.schema("Preferences") },
        drafts: { kind: "map", schema: ref.schema("Draft") },
      },
    }),
  );

  const trellis = createClient(
    contract,
    { options: { inboxPrefix: "_INBOX.test" } } as never,
    { sessionKey: "test", sign: () => new Uint8Array(64) },
  );

  const nats = Reflect.get(trellis, "nats") as {
    request(
      subject: string,
    ): Promise<
      {
        json(): unknown;
        headers?: { get(name: string): string | null | undefined };
      }
    >;
  };
  nats.request = async (subject: string) => ({
    json: () =>
      subject === "rpc.v1.State.Get"
        ? {
          found: true,
          entry: {
            value: { theme: 123 },
            revision: "1",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        }
        : {
          entries: [{
            key: "open/one",
            value: { title: 123 },
            revision: "2",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }],
          count: 1,
          offset: 0,
          limit: 100,
        },
    headers: { get: () => undefined },
  });

  const getResult = await trellis.state.preferences.get();
  assertEquals(getResult.isErr(), true);
  if (getResult.isOk()) throw new Error("expected validation error");
  assertEquals(getResult.error instanceof ValidationError, true);

  const listResult = await trellis.state.drafts.list();
  assertEquals(listResult.isErr(), true);
  if (listResult.isOk()) throw new Error("expected validation error");
  assertEquals(listResult.error instanceof ValidationError, true);
});

Deno.test("connected runtime surfaces accepted state migrations without running them", async () => {
  const contract = defineAppContract(
    {
      schemas: {
        Draft: Type.Object({ text: Type.String() }),
        DraftV0: Type.Object({ title: Type.String() }),
      },
    },
    (ref) => ({
      id: "acme.state-runtime-migration@v1",
      displayName: "State Runtime Migration",
      description: "Exercise facade migration responses.",
      state: {
        drafts: {
          kind: "map",
          schema: ref.schema("Draft"),
          stateVersion: "draft.v1",
          acceptedVersions: { "draft.v0": ref.schema("DraftV0") },
        },
      },
    }),
  );

  const trellis = createClient(
    contract,
    { options: { inboxPrefix: "_INBOX.test" } } as never,
    { sessionKey: "test", sign: () => new Uint8Array(64) },
  );

  const nats = Reflect.get(trellis, "nats") as {
    request(): Promise<{
      json(): unknown;
      headers?: { get(name: string): string | null | undefined };
    }>;
  };
  nats.request = async () => ({
    json: () => ({
      migrationRequired: true,
      entry: {
        key: "old",
        value: { title: "legacy" },
        revision: "1",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      stateVersion: "draft.v0",
      currentStateVersion: "draft.v1",
      writerContractDigest: "old-digest",
    }),
    headers: { get: () => undefined },
  });

  const result = await trellis.state.drafts.get("old");
  if (result.isErr()) throw result.error;
  const migration = result.unwrapOrElse(() => {
    throw new Error("expected migration result");
  });
  assertEquals(migration, {
    migrationRequired: true,
    entry: {
      key: "old",
      value: { title: "legacy" },
      revision: "1",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    stateVersion: "draft.v0",
    currentStateVersion: "draft.v1",
    writerContractDigest: "old-digest",
  });

  nats.request = async () => ({
    json: () => ({
      applied: false,
      found: true,
      entry: {
        migrationRequired: true,
        entry: {
          key: "old",
          value: { title: "legacy" },
          revision: "1",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        stateVersion: "draft.v0",
        currentStateVersion: "draft.v1",
        writerContractDigest: "old-digest",
      },
    }),
    headers: { get: () => undefined },
  });

  const putResult = await trellis.state.drafts.put("old", { text: "new" }, {
    expectedRevision: null,
  });
  if (putResult.isErr()) throw putResult.error;
  const conflict = putResult.unwrapOrElse(() => {
    throw new Error("expected put conflict");
  });
  assertEquals(conflict, {
    applied: false,
    found: true,
    entry: {
      migrationRequired: true,
      entry: {
        key: "old",
        value: { title: "legacy" },
        revision: "1",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      stateVersion: "draft.v0",
      currentStateVersion: "draft.v1",
      writerContractDigest: "old-digest",
    },
  });
});
