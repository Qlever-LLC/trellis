import { assertEquals } from "@std/assert";
import { err, ok, UnexpectedError } from "@qlever-llc/result";

import { resolveSessionPrincipal } from "./principal.ts";

function kvFromMap<T>(values: Record<string, T>) {
  return {
    get: async (key: string) => {
      if (key in values) {
        return ok({ value: values[key] });
      }
      return err(new UnexpectedError({ cause: new Error(`missing ${key}`) }));
    },
    keys: async (filter: string) => {
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
      return ok({
        async *[Symbol.asyncIterator]() {
          for (const key of matches) yield key;
        },
      });
    },
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
      servicesKV: kvFromMap({}),
      deviceActivationsKV: kvFromMap({
        "dev-1": {
          instanceId: "dev-1",
          publicIdentityKey: "A".repeat(43),
          profileId: "drive.default",
          state: "activated",
          activatedAt: new Date().toISOString(),
          revokedAt: null,
        },
      }),
      deviceProfilesKV: kvFromMap({
        "drive.default": {
          profileId: "drive.default",
          disabled: false,
        },
      }),
      usersKV: kvFromMap({}),
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
      servicesKV: kvFromMap({}),
      deviceActivationsKV: kvFromMap({
        "dev-1": {
          instanceId: "dev-1",
          publicIdentityKey: "A".repeat(43),
          profileId: "drive.default",
          state: "revoked",
          activatedAt: new Date().toISOString(),
          revokedAt: new Date().toISOString(),
        },
      }),
      deviceProfilesKV: kvFromMap({
        "drive.default": {
          profileId: "drive.default",
          disabled: false,
        },
      }),
      usersKV: kvFromMap({}),
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
      servicesKV: kvFromMap({}),
      deviceActivationsKV: kvFromMap({
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
      deviceProfilesKV: kvFromMap({
        "drive.default": {
          profileId: "drive.default",
          disabled: false,
        },
      }),
      usersKV: kvFromMap({}),
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
      servicesKV: kvFromMap({}),
      deviceActivationsKV: kvFromMap({
        "dev-other": {
          instanceId: "dev-other",
          publicIdentityKey: "A".repeat(43),
          profileId: "drive.default",
          state: "activated",
          activatedAt: new Date().toISOString(),
          revokedAt: null,
        },
      }),
      deviceProfilesKV: kvFromMap({
        "drive.default": {
          profileId: "drive.default",
          disabled: false,
        },
      }),
      usersKV: kvFromMap({}),
    },
  );

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error.reason, "unknown_device");
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
      servicesKV: kvFromMap({}),
      deviceActivationsKV: kvFromMap({
        "dev-1": {
          instanceId: "dev-1",
          publicIdentityKey: "A".repeat(43),
          profileId: "drive.next",
          state: "activated",
          activatedAt: new Date().toISOString(),
          revokedAt: null,
        },
      }),
      deviceProfilesKV: kvFromMap({
        "drive.next": {
          profileId: "drive.next",
          disabled: false,
        },
      }),
      usersKV: kvFromMap({}),
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
      servicesKV: kvFromMap({}),
      deviceActivationsKV: kvFromMap({
        "dev-1": {
          instanceId: "dev-1",
          publicIdentityKey: "A".repeat(43),
          profileId: "drive.default",
          state: "activated",
          activatedAt: new Date().toISOString(),
          revokedAt: null,
        },
      }),
      deviceProfilesKV: kvFromMap({
        "drive.default": {
          profileId: "drive.default",
          disabled: true,
        },
      }),
      usersKV: kvFromMap({}),
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
      servicesKV: kvFromMap({}),
      usersKV: kvFromMap({
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
      servicesKV: kvFromMap({}),
      usersKV: kvFromMap({
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
      servicesKV: kvFromMap({}),
      usersKV: kvFromMap({
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
