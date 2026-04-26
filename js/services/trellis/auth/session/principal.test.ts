import { assertEquals } from "@std/assert";
import { AsyncResult, err, ok, UnexpectedError } from "@qlever-llc/result";

import { resolveSessionPrincipal } from "./principal.ts";
import {
  initializeTrellisStorageSchema,
  openTrellisStorageDb,
} from "../../storage/db.ts";
import { SqlContractApprovalRepository } from "../storage.ts";

function kvFromMap<T>(values: Record<string, T>) {
  return {
    get: (key: string) => {
      if (key in values) {
        return AsyncResult.lift(ok({ value: values[key] }));
      }
      return AsyncResult.lift(
        err(new UnexpectedError({ cause: new Error(`missing ${key}`) })),
      );
    },
    keys: (filter: string) => {
      const parts = filter.split(".");
      const matches = Object.keys(values).filter((key) => {
        const keyParts = key.split(".");
        let i = 0;
        for (; i < parts.length; i += 1) {
          const part = parts[i];
          if (part === ">") return true;
          if (keyParts[i] === undefined) return false;
          if (part !== "*" && part !== keyParts[i]) return false;
        }
        return i === keyParts.length;
      });
      return AsyncResult.lift(ok({
        async *[Symbol.asyncIterator]() {
          for (const key of matches) yield key;
        },
      }));
    },
  };
}

function loadProjectionFromMap<T>(values: Record<string, T>) {
  return async (trellisId: string): Promise<T | null> => {
    return values[trellisId] ?? null;
  };
}

function storageFromMap<T>(values: Record<string, T>) {
  return {
    get: async (key: string): Promise<T | undefined> => values[key],
  };
}

Deno.test("resolveSessionPrincipal accepts activated device sessions", async () => {
  const result = await resolveSessionPrincipal(
    {
      type: "device",
      instanceId: "dev-1",
      publicIdentityKey: "A".repeat(43),
      profileId: "drive.default",
      contractId: "trellis.device@v1",
      contractDigest: "digest-a",
      delegatedCapabilities: ["device.sync"],
      delegatedPublishSubjects: ["subject.v1.device.sync"],
      delegatedSubscribeSubjects: ["events.v1.Device.Status.*"],
      createdAt: new Date(),
      lastAuth: new Date(),
      activatedAt: null,
      revokedAt: null,
    },
    "A".repeat(43),
    {
      deviceActivationStorage: storageFromMap({
        "dev-1": {
          instanceId: "dev-1",
          publicIdentityKey: "A".repeat(43),
          profileId: "drive.default",
          state: "activated",
          activatedAt: new Date().toISOString(),
          revokedAt: null,
        },
      }),
      deviceProfileStorage: storageFromMap({
        "drive.default": {
          profileId: "drive.default",
          disabled: false,
        },
      }),
      loadUserProjection: loadProjectionFromMap({}),
    },
  );

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.active, true);
    assertEquals(result.value.capabilities, ["device.sync"]);
    assertEquals(result.value.email, "device:dev-1");
  }
});

Deno.test("resolveSessionPrincipal rejects revoked device sessions", async () => {
  const result = await resolveSessionPrincipal(
    {
      type: "device",
      instanceId: "dev-1",
      publicIdentityKey: "A".repeat(43),
      profileId: "drive.default",
      contractId: "trellis.device@v1",
      contractDigest: "digest-a",
      delegatedCapabilities: ["device.sync"],
      delegatedPublishSubjects: ["subject.v1.device.sync"],
      delegatedSubscribeSubjects: ["events.v1.Device.Status.*"],
      createdAt: new Date(),
      lastAuth: new Date(),
      activatedAt: null,
      revokedAt: null,
    },
    "A".repeat(43),
    {
      deviceActivationStorage: storageFromMap({
        "dev-1": {
          instanceId: "dev-1",
          publicIdentityKey: "A".repeat(43),
          profileId: "drive.default",
          state: "revoked",
          activatedAt: new Date().toISOString(),
          revokedAt: new Date().toISOString(),
        },
      }),
      deviceProfileStorage: storageFromMap({
        "drive.default": {
          profileId: "drive.default",
          disabled: false,
        },
      }),
      loadUserProjection: loadProjectionFromMap({}),
    },
  );

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error.reason, "device_activation_revoked");
  }
});

Deno.test("resolveSessionPrincipal uses the activation matching session.publicIdentityKey", async () => {
  const result = await resolveSessionPrincipal(
    {
      type: "device",
      instanceId: "dev-1",
      publicIdentityKey: "B".repeat(43),
      profileId: "drive.default",
      contractId: "trellis.device@v1",
      contractDigest: "digest-a",
      delegatedCapabilities: ["device.sync"],
      delegatedPublishSubjects: ["subject.v1.device.sync"],
      delegatedSubscribeSubjects: ["events.v1.Device.Status.*"],
      createdAt: new Date(),
      lastAuth: new Date(),
      activatedAt: null,
      revokedAt: null,
    },
    "B".repeat(43),
    {
      deviceActivationStorage: storageFromMap({
        "dev-old": {
          instanceId: "dev-old",
          publicIdentityKey: "A".repeat(43),
          profileId: "drive.default",
          state: "revoked",
          activatedAt: new Date().toISOString(),
          revokedAt: new Date().toISOString(),
        },
        "dev-1": {
          instanceId: "dev-1",
          publicIdentityKey: "B".repeat(43),
          profileId: "drive.default",
          state: "activated",
          activatedAt: new Date().toISOString(),
          revokedAt: null,
        },
      }),
      deviceProfileStorage: storageFromMap({
        "drive.default": {
          profileId: "drive.default",
          disabled: false,
        },
      }),
      loadUserProjection: loadProjectionFromMap({}),
    },
  );

  assertEquals(result.ok, true);
});

Deno.test("resolveSessionPrincipal does not borrow another activation for the same device", async () => {
  const result = await resolveSessionPrincipal(
    {
      type: "device",
      instanceId: "dev-1",
      publicIdentityKey: "B".repeat(43),
      profileId: "drive.default",
      contractId: "trellis.device@v1",
      contractDigest: "digest-a",
      delegatedCapabilities: ["device.sync"],
      delegatedPublishSubjects: ["subject.v1.device.sync"],
      delegatedSubscribeSubjects: ["events.v1.Device.Status.*"],
      createdAt: new Date(),
      lastAuth: new Date(),
      activatedAt: null,
      revokedAt: null,
    },
    "B".repeat(43),
    {
      deviceActivationStorage: storageFromMap({
        "dev-other": {
          instanceId: "dev-other",
          publicIdentityKey: "A".repeat(43),
          profileId: "drive.default",
          state: "activated",
          activatedAt: new Date().toISOString(),
          revokedAt: null,
        },
      }),
      deviceProfileStorage: storageFromMap({
        "drive.default": {
          profileId: "drive.default",
          disabled: false,
        },
      }),
      loadUserProjection: loadProjectionFromMap({}),
    },
  );

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error.reason, "unknown_device");
  }
});

Deno.test("resolveSessionPrincipal rejects device sessions when the public identity key changes", async () => {
  const result = await resolveSessionPrincipal(
    {
      type: "device",
      instanceId: "dev-1",
      publicIdentityKey: "A".repeat(43),
      profileId: "drive.default",
      contractId: "trellis.device@v1",
      contractDigest: "digest-a",
      delegatedCapabilities: ["device.sync"],
      delegatedPublishSubjects: ["subject.v1.device.sync"],
      delegatedSubscribeSubjects: ["events.v1.Device.Status.*"],
      createdAt: new Date(),
      lastAuth: new Date(),
      activatedAt: null,
      revokedAt: null,
    },
    "A".repeat(43),
    {
      deviceActivationStorage: storageFromMap({
        "dev-1": {
          instanceId: "dev-1",
          publicIdentityKey: "B".repeat(43),
          profileId: "drive.default",
          state: "activated",
          activatedAt: new Date().toISOString(),
          revokedAt: null,
        },
      }),
      deviceProfileStorage: storageFromMap({
        "drive.default": {
          profileId: "drive.default",
          disabled: false,
        },
      }),
      loadUserProjection: loadProjectionFromMap({}),
    },
  );

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error.reason, "device_activation_revoked");
  }
});

Deno.test("resolveSessionPrincipal looks up SQL approvals for dotted user ids", async () => {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-principal-",
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    await initializeTrellisStorageSchema(storage);
    const approvals = new SqlContractApprovalRepository(storage.db);
    const userTrellisId = "github.user.with.dots";
    await approvals.put({
      userTrellisId,
      origin: "github",
      id: "user.with.dots",
      answer: "approved",
      answeredAt: new Date("2026-04-10T00:00:00.000Z"),
      updatedAt: new Date("2026-04-11T00:00:00.000Z"),
      approval: {
        contractDigest: "digest-agent",
        contractId: "trellis.agent@v1",
        displayName: "Trellis Agent",
        description: "Local delegated tooling",
        participantKind: "agent",
        capabilities: ["jobs.read"],
      },
      publishSubjects: [],
      subscribeSubjects: [],
    });

    const result = await resolveSessionPrincipal(
      {
        type: "user",
        trellisId: userTrellisId,
        origin: "github",
        id: "user.with.dots",
        email: "ada@example.com",
        name: "Ada",
        participantKind: "agent",
        contractDigest: "digest-agent",
        contractId: "trellis.agent@v1",
        contractDisplayName: "Trellis Agent",
        contractDescription: "Local delegated tooling",
        delegatedCapabilities: ["jobs.read"],
        delegatedPublishSubjects: [],
        delegatedSubscribeSubjects: [],
        createdAt: new Date(),
        lastAuth: new Date(),
      },
      "sk_agent",
      {
        loadUserProjection: loadProjectionFromMap({
          [userTrellisId]: {
            origin: "github",
            id: "user.with.dots",
            name: "Ada",
            email: "ada@example.com",
            active: true,
            capabilities: ["jobs.read"],
          },
        }),
        loadStoredApproval: async (key) => {
          const separator = key.lastIndexOf(".");
          if (separator <= 0 || separator >= key.length - 1) return null;
          return await approvals.get(
            key.slice(0, separator),
            key.slice(separator + 1),
          ) ?? null;
        },
      },
    );

    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.value.capabilities, ["jobs.read"]);
    }
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});

Deno.test("resolveSessionPrincipal rejects device sessions when the activation profile changes", async () => {
  const result = await resolveSessionPrincipal(
    {
      type: "device",
      instanceId: "dev-1",
      publicIdentityKey: "A".repeat(43),
      profileId: "drive.default",
      contractId: "trellis.device@v1",
      contractDigest: "digest-a",
      delegatedCapabilities: ["device.sync"],
      delegatedPublishSubjects: ["subject.v1.device.sync"],
      delegatedSubscribeSubjects: ["events.v1.Device.Status.*"],
      createdAt: new Date(),
      lastAuth: new Date(),
      activatedAt: null,
      revokedAt: null,
    },
    "A".repeat(43),
    {
      deviceActivationStorage: storageFromMap({
        "dev-1": {
          instanceId: "dev-1",
          publicIdentityKey: "A".repeat(43),
          profileId: "drive.next",
          state: "activated",
          activatedAt: new Date().toISOString(),
          revokedAt: null,
        },
      }),
      deviceProfileStorage: storageFromMap({
        "drive.next": {
          profileId: "drive.next",
          disabled: false,
        },
      }),
      loadUserProjection: loadProjectionFromMap({}),
    },
  );

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error.reason, "device_activation_revoked");
  }
});

Deno.test("resolveSessionPrincipal rejects disabled device profiles", async () => {
  const result = await resolveSessionPrincipal(
    {
      type: "device",
      instanceId: "dev-1",
      publicIdentityKey: "A".repeat(43),
      profileId: "drive.default",
      contractId: "trellis.device@v1",
      contractDigest: "digest-a",
      delegatedCapabilities: ["device.sync"],
      delegatedPublishSubjects: ["subject.v1.device.sync"],
      delegatedSubscribeSubjects: ["events.v1.Device.Status.*"],
      createdAt: new Date(),
      lastAuth: new Date(),
      activatedAt: null,
      revokedAt: null,
    },
    "A".repeat(43),
    {
      deviceActivationStorage: storageFromMap({
        "dev-1": {
          instanceId: "dev-1",
          publicIdentityKey: "A".repeat(43),
          profileId: "drive.default",
          state: "activated",
          activatedAt: new Date().toISOString(),
          revokedAt: null,
        },
      }),
      deviceProfileStorage: storageFromMap({
        "drive.default": {
          profileId: "drive.default",
          disabled: true,
        },
      }),
      loadUserProjection: loadProjectionFromMap({}),
    },
  );

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error.reason, "device_profile_disabled");
  }
});

Deno.test("resolveSessionPrincipal rejects inactive user projections", async () => {
  const result = await resolveSessionPrincipal(
    {
      type: "user",
      trellisId: "tid",
      origin: "github",
      id: "123",
      email: "user@example.com",
      name: "User",
      participantKind: "app",
      contractDigest: "digest-a",
      contractId: "trellis.console@v1",
      contractDisplayName: "Console",
      contractDescription: "Admin app",
      delegatedCapabilities: ["admin"],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: [],
      createdAt: new Date(),
      lastAuth: new Date(),
    },
    "A".repeat(43),
    {
      loadUserProjection: loadProjectionFromMap({
        tid: {
          origin: "github",
          id: "123",
          name: "User",
          email: "user@example.com",
          active: false,
          capabilities: ["admin"],
        },
      }),
    },
  );

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error.reason, "user_inactive");
  }
});

Deno.test("resolveSessionPrincipal accepts user sessions with matching instance grant policy", async () => {
  const result = await resolveSessionPrincipal(
    {
      type: "user",
      trellisId: "tid",
      origin: "github",
      id: "123",
      email: "user@example.com",
      name: "User",
      participantKind: "app",
      contractDigest: "digest-a",
      contractId: "trellis.console@v1",
      contractDisplayName: "Console",
      contractDescription: "Admin app",
      delegatedCapabilities: ["audit"],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: [],
      app: {
        contractId: "trellis.console@v1",
        origin: "https://app.example.com",
      },
      appOrigin: "https://app.example.com",
      approvalSource: "admin_policy",
      createdAt: new Date(),
      lastAuth: new Date(),
    },
    "A".repeat(43),
    {
      loadUserProjection: loadProjectionFromMap({
        tid: {
          origin: "github",
          id: "123",
          name: "User",
          email: "user@example.com",
          active: true,
          capabilities: [],
        },
      }),
      loadInstanceGrantPolicies: async () => [{
        contractId: "trellis.console@v1",
        impliedCapabilities: ["audit"],
        allowedOrigins: ["https://app.example.com"],
        disabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: { kind: "admin_policy" },
      }],
    },
  );

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.capabilities, ["audit"]);
  }
});

Deno.test("resolveSessionPrincipal still matches instance grant policy from legacy appOrigin", async () => {
  const result = await resolveSessionPrincipal(
    {
      type: "user",
      trellisId: "tid",
      origin: "github",
      id: "123",
      email: "user@example.com",
      name: "User",
      participantKind: "app",
      contractDigest: "digest-a",
      contractId: "trellis.console@v1",
      contractDisplayName: "Console",
      contractDescription: "Admin app",
      delegatedCapabilities: ["audit"],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: [],
      appOrigin: "https://app.example.com",
      approvalSource: "admin_policy",
      createdAt: new Date(),
      lastAuth: new Date(),
    },
    "A".repeat(43),
    {
      loadUserProjection: loadProjectionFromMap({
        tid: {
          origin: "github",
          id: "123",
          name: "User",
          email: "user@example.com",
          active: true,
          capabilities: [],
        },
      }),
      loadInstanceGrantPolicies: async () => [{
        contractId: "trellis.console@v1",
        impliedCapabilities: ["audit"],
        allowedOrigins: ["https://app.example.com"],
        disabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: { kind: "admin_policy" },
      }],
    },
  );

  assertEquals(result.ok, true);
});
