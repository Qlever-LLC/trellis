import { assertEquals } from "@std/assert";
import { AsyncResult, err, ok, UnexpectedError } from "@qlever-llc/result";

import { resolveSessionPrincipal } from "./principal.ts";

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
      deploymentId: "drive.default",
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
          deploymentId: "drive.default",
          state: "activated",
          activatedAt: new Date().toISOString(),
          revokedAt: null,
        },
      }),
      deviceInstanceStorage: storageFromMap({
        "dev-1": {
          instanceId: "dev-1",
          publicIdentityKey: "A".repeat(43),
          deploymentId: "drive.default",
          state: "activated",
        },
      }),
      deviceDeploymentStorage: storageFromMap({
        "drive.default": {
          deploymentId: "drive.default",
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

Deno.test("resolveSessionPrincipal accepts registered device runtime sessions with delegated permissions", async () => {
  const result = await resolveSessionPrincipal(
    {
      type: "device",
      instanceId: "dev-1",
      publicIdentityKey: "A".repeat(43),
      deploymentId: "drive.default",
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
      deviceActivationStorage: storageFromMap({}),
      deviceInstanceStorage: storageFromMap({
        "dev-1": {
          instanceId: "dev-1",
          publicIdentityKey: "A".repeat(43),
          deploymentId: "drive.default",
          state: "registered",
        },
      }),
      deviceDeploymentStorage: storageFromMap({
        "drive.default": {
          deploymentId: "drive.default",
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
  }
});

Deno.test("resolveSessionPrincipal accepts registered device runtime sessions without legacy policy", async () => {
  const result = await resolveSessionPrincipal(
    {
      type: "device",
      instanceId: "dev-1",
      publicIdentityKey: "A".repeat(43),
      deploymentId: "drive.default",
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
      deviceActivationStorage: storageFromMap({}),
      deviceInstanceStorage: storageFromMap({
        "dev-1": {
          instanceId: "dev-1",
          publicIdentityKey: "A".repeat(43),
          deploymentId: "drive.default",
          state: "registered",
        },
      }),
      deviceDeploymentStorage: storageFromMap({
        "drive.default": {
          deploymentId: "drive.default",
          disabled: false,
        },
      }),
      loadUserProjection: loadProjectionFromMap({}),
    },
  );

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.capabilities, ["device.sync"]);
  }
});

Deno.test("resolveSessionPrincipal rejects revoked device sessions", async () => {
  const result = await resolveSessionPrincipal(
    {
      type: "device",
      instanceId: "dev-1",
      publicIdentityKey: "A".repeat(43),
      deploymentId: "drive.default",
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
          deploymentId: "drive.default",
          state: "revoked",
          activatedAt: new Date().toISOString(),
          revokedAt: new Date().toISOString(),
        },
      }),
      deviceDeploymentStorage: storageFromMap({
        "drive.default": {
          deploymentId: "drive.default",
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
      deploymentId: "drive.default",
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
          deploymentId: "drive.default",
          state: "revoked",
          activatedAt: new Date().toISOString(),
          revokedAt: new Date().toISOString(),
        },
        "dev-1": {
          instanceId: "dev-1",
          publicIdentityKey: "B".repeat(43),
          deploymentId: "drive.default",
          state: "activated",
          activatedAt: new Date().toISOString(),
          revokedAt: null,
        },
      }),
      deviceInstanceStorage: storageFromMap({
        "dev-1": {
          instanceId: "dev-1",
          publicIdentityKey: "B".repeat(43),
          deploymentId: "drive.default",
          state: "activated",
        },
      }),
      deviceDeploymentStorage: storageFromMap({
        "drive.default": {
          deploymentId: "drive.default",
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
      deploymentId: "drive.default",
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
          deploymentId: "drive.default",
          state: "activated",
          activatedAt: new Date().toISOString(),
          revokedAt: null,
        },
      }),
      deviceInstanceStorage: storageFromMap({
        "dev-1": {
          instanceId: "dev-1",
          publicIdentityKey: "A".repeat(43),
          deploymentId: "drive.default",
          state: "activated",
        },
      }),
      deviceDeploymentStorage: storageFromMap({
        "drive.default": {
          deploymentId: "drive.default",
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
      deploymentId: "drive.default",
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
          deploymentId: "drive.default",
          state: "activated",
          activatedAt: new Date().toISOString(),
          revokedAt: null,
        },
      }),
      deviceInstanceStorage: storageFromMap({
        "dev-1": {
          instanceId: "dev-1",
          publicIdentityKey: "A".repeat(43),
          deploymentId: "drive.default",
          state: "activated",
        },
      }),
      deviceDeploymentStorage: storageFromMap({
        "drive.default": {
          deploymentId: "drive.default",
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

Deno.test("resolveSessionPrincipal rejects device sessions when the activation deployment changes", async () => {
  const result = await resolveSessionPrincipal(
    {
      type: "device",
      instanceId: "dev-1",
      publicIdentityKey: "A".repeat(43),
      deploymentId: "drive.default",
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
          deploymentId: "drive.next",
          state: "activated",
          activatedAt: new Date().toISOString(),
          revokedAt: null,
        },
      }),
      deviceDeploymentStorage: storageFromMap({
        "drive.next": {
          deploymentId: "drive.next",
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

Deno.test("resolveSessionPrincipal rejects device sessions when instance deployment changes", async () => {
  const result = await resolveSessionPrincipal(
    {
      type: "device",
      instanceId: "dev-1",
      publicIdentityKey: "A".repeat(43),
      deploymentId: "drive.default",
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
          deploymentId: "drive.default",
          state: "activated",
          activatedAt: new Date().toISOString(),
          revokedAt: null,
        },
      }),
      deviceInstanceStorage: storageFromMap({
        "dev-1": {
          instanceId: "dev-1",
          publicIdentityKey: "A".repeat(43),
          deploymentId: "drive.next",
          state: "activated",
        },
      }),
      deviceDeploymentStorage: storageFromMap({
        "drive.default": {
          deploymentId: "drive.default",
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

Deno.test("resolveSessionPrincipal rejects disabled device deployments", async () => {
  const result = await resolveSessionPrincipal(
    {
      type: "device",
      instanceId: "dev-1",
      publicIdentityKey: "A".repeat(43),
      deploymentId: "drive.default",
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
          deploymentId: "drive.default",
          state: "activated",
          activatedAt: new Date().toISOString(),
          revokedAt: null,
        },
      }),
      deviceInstanceStorage: storageFromMap({
        "dev-1": {
          instanceId: "dev-1",
          publicIdentityKey: "A".repeat(43),
          deploymentId: "drive.default",
          state: "activated",
        },
      }),
      deviceDeploymentStorage: storageFromMap({
        "drive.default": {
          deploymentId: "drive.default",
          disabled: true,
        },
      }),
      loadUserProjection: loadProjectionFromMap({}),
    },
  );

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error.reason, "device_deployment_disabled");
  }
});

Deno.test("resolveSessionPrincipal rejects inactive user projections", async () => {
  const result = await resolveSessionPrincipal(
    {
      type: "user",
      userId: "tid",
      identity: {
        identityId: "idn-github-123",
        provider: "github",
        subject: "123",
      },
      email: "user@example.com",
      name: "User",
      participantKind: "app",
      identityEnvelopeId: "env-console",
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
          capabilityGroups: [],
        },
      }),
    },
  );

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error.reason, "user_inactive");
  }
});

Deno.test("resolveSessionPrincipal rejects user sessions without explicit capabilities", async () => {
  const result = await resolveSessionPrincipal(
    {
      type: "user",
      userId: "tid",
      identity: {
        identityId: "idn-github-123",
        provider: "github",
        subject: "123",
      },
      email: "user@example.com",
      name: "User",
      participantKind: "app",
      identityEnvelopeId: "env-console",
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
          capabilityGroups: [],
        },
      }),
    },
  );

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error.reason, "insufficient_permissions");
  }
});

Deno.test("resolveSessionPrincipal accepts delegated capabilities from groups", async () => {
  const result = await resolveSessionPrincipal(
    {
      type: "user",
      userId: "tid",
      identity: {
        identityId: "idn-github-123",
        provider: "github",
        subject: "123",
      },
      email: "user@example.com",
      name: "User",
      participantKind: "app",
      identityEnvelopeId: "env-console",
      contractDigest: "digest-a",
      contractId: "trellis.console@v1",
      contractDisplayName: "Console",
      contractDescription: "Admin app",
      delegatedCapabilities: ["trellis.auth::device.review"],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: [],
      app: {
        contractId: "trellis.console@v1",
        origin: "https://app.example.com",
      },
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
          capabilityGroups: ["admin"],
        },
      }),
    },
  );

  assertEquals(result.ok, true);
});

Deno.test("resolveSessionPrincipal accepts service-like capability strings on user sessions", async () => {
  const result = await resolveSessionPrincipal(
    {
      type: "user",
      userId: "tid",
      identity: {
        identityId: "idn-github-123",
        provider: "github",
        subject: "123",
      },
      email: "user@example.com",
      name: "User",
      participantKind: "app",
      identityEnvelopeId: "env-console",
      contractDigest: "digest-a",
      contractId: "trellis.console@v1",
      contractDisplayName: "Console",
      contractDescription: "Admin app",
      delegatedCapabilities: ["service:inspect"],
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
          active: true,
          capabilities: ["service:inspect"],
          capabilityGroups: [],
        },
      }),
    },
  );

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.capabilities, ["service:inspect"]);
  }
});

Deno.test("resolveSessionPrincipal uses current service instance contract metadata", async () => {
  const result = await resolveSessionPrincipal(
    {
      type: "service",
      trellisId: "service-trellis-id",
      origin: "service",
      id: "service-key",
      email: "svc@example.com",
      name: "Worker service",
      instanceId: "instance-old",
      deploymentId: "worker.default",
      instanceKey: "service-key",
      currentContractId: "worker.old@v1",
      currentContractDigest: "digest-old",
      createdAt: new Date(),
      lastAuth: new Date(),
    },
    "service-key",
    {
      loadServiceInstance: async () => ({
        instanceId: "instance-current",
        deploymentId: "worker.default",
        instanceKey: "service-key",
        disabled: false,
        currentContractId: "worker.current@v1",
        currentContractDigest: "digest-current",
        capabilities: ["service", "worker.run"],
      }),
      loadServiceDeployment: async () => ({
        deploymentId: "worker.default",
        disabled: false,
      }),
      loadUserProjection: loadProjectionFromMap({}),
    },
  );

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.capabilities, ["service", "worker.run"]);
    assertEquals(
      result.value.serviceState?.currentContractId,
      "worker.current@v1",
    );
    assertEquals(
      result.value.serviceState?.currentContractDigest,
      "digest-current",
    );
  }
});
