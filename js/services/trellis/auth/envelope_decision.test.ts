import { assertEquals } from "@std/assert";

import {
  applyGrantOverrideCapabilities,
  boundaryToDeploymentEnvelopeRows,
  computeEnvelopeDelta,
  evaluateEnvelopeFit,
  previewEnvelopeShrinkImpact,
} from "./envelope_decision.ts";
import type { DeploymentGrantOverride, EnvelopeBoundary } from "./schemas.ts";

const EMPTY_BOUNDARY: EnvelopeBoundary = {
  contracts: [],
  surfaces: [],
  capabilities: [],
  resources: [],
};

function boundary(overrides: Partial<EnvelopeBoundary>): EnvelopeBoundary {
  return {
    contracts: [],
    surfaces: [],
    capabilities: [],
    resources: [],
    ...overrides,
  };
}

const fullEnvelope = boundary({
  contracts: [{ contractId: "core@v1", required: true }],
  surfaces: [{
    contractId: "core@v1",
    kind: "rpc",
    name: "Users.Get",
    action: "call",
    required: true,
  }],
  capabilities: ["users.read"],
  resources: [{ kind: "kv", alias: "sessions", required: true }],
});

Deno.test("evaluateEnvelopeFit separates missing availability from missing capabilities", () => {
  const requested = boundary({
    contracts: [{ contractId: "core@v1", required: true }],
    surfaces: [
      {
        contractId: "core@v1",
        kind: "rpc",
        name: "Users.Get",
        action: "call",
        required: true,
      },
      {
        contractId: "billing@v1",
        kind: "operation",
        name: "Invoices.Export",
        action: "call",
        required: true,
      },
    ],
    capabilities: ["billing.export", "users.read"],
    resources: [{ kind: "kv", alias: "sessions", required: true }],
  });

  assertEquals(evaluateEnvelopeFit(fullEnvelope, requested), {
    fits: false,
    missingAvailability: boundary({
      surfaces: [{
        contractId: "billing@v1",
        kind: "operation",
        name: "Invoices.Export",
        action: "call",
        required: true,
      }],
    }),
    missingCapabilities: ["billing.export"],
  });
});

Deno.test("computeEnvelopeDelta returns only unavailable rows and missing capabilities", () => {
  const requested = boundary({
    contracts: [
      { contractId: "core@v1", required: true },
      { contractId: "optional@v1", required: false },
    ],
    surfaces: [{
      contractId: "optional@v1",
      kind: "event",
      name: "Events.Created",
      action: "subscribe",
      required: false,
    }],
    capabilities: ["events.read", "users.read"],
    resources: [
      { kind: "kv", alias: "sessions", required: true },
      { kind: "store", alias: "exports", required: false },
    ],
  });

  assertEquals(
    computeEnvelopeDelta(fullEnvelope, requested),
    boundary({
      contracts: [{ contractId: "optional@v1", required: false }],
      surfaces: [{
        contractId: "optional@v1",
        kind: "event",
        name: "Events.Created",
        action: "subscribe",
        required: false,
      }],
      capabilities: ["events.read"],
      resources: [{ kind: "store", alias: "exports", required: false }],
    }),
  );
});

Deno.test("grant overrides add capabilities only for matching identities", async () => {
  const grants: DeploymentGrantOverride[] = [
    {
      deploymentId: "app-a",
      identityKind: "web",
      grantKind: "capability",
      contractId: "core@v1",
      origin: "https://app.example",
      sessionPublicKey: null,
      capability: "users.write",
      capabilityGroupKey: null,
    },
    {
      deploymentId: "app-a",
      identityKind: "session",
      grantKind: "capability",
      contractId: "core@v1",
      origin: null,
      sessionPublicKey: "session-a",
      capability: "users.read",
      capabilityGroupKey: null,
    },
  ];

  assertEquals(
    await applyGrantOverrideCapabilities(EMPTY_BOUNDARY, grants, {
      kind: "web",
      contractId: "core@v1",
      origin: "https://app.example",
    }),
    boundary({ capabilities: ["users.write"] }),
  );

  assertEquals(
    await applyGrantOverrideCapabilities(EMPTY_BOUNDARY, grants, {
      kind: "cli",
      contractId: "core@v1",
      sessionPublicKey: "session-a",
    }),
    boundary({ capabilities: ["users.read"] }),
  );

  assertEquals(
    await applyGrantOverrideCapabilities(EMPTY_BOUNDARY, grants, {
      kind: "web",
      contractId: "core@v1",
      origin: "https://other.example",
    }),
    EMPTY_BOUNDARY,
  );
});

Deno.test("grant overrides do not invent envelope availability", async () => {
  const effective = await applyGrantOverrideCapabilities(
    boundary({ capabilities: ["users.read"] }),
    [{
      deploymentId: "app-a",
      identityKind: "session",
      grantKind: "capability",
      contractId: "billing@v1",
      origin: null,
      sessionPublicKey: "session-a",
      capability: "billing.export",
      capabilityGroupKey: null,
    }],
    { kind: "cli", contractId: "billing@v1", sessionPublicKey: "session-a" },
  );

  assertEquals(
    evaluateEnvelopeFit(
      effective,
      boundary({
        surfaces: [{
          contractId: "billing@v1",
          kind: "operation",
          name: "Invoices.Export",
          action: "call",
          required: true,
        }],
        capabilities: ["billing.export"],
      }),
    ),
    {
      fits: false,
      missingAvailability: boundary({
        surfaces: [{
          contractId: "billing@v1",
          kind: "operation",
          name: "Invoices.Export",
          action: "call",
          required: true,
        }],
      }),
      missingCapabilities: [],
    },
  );
});

Deno.test("grant override matching requires every provided discriminator", async () => {
  assertEquals(
    await applyGrantOverrideCapabilities(
      EMPTY_BOUNDARY,
      [{
        deploymentId: "app-a",
        identityKind: "session",
        grantKind: "capability",
        contractId: "core@v1",
        origin: null,
        sessionPublicKey: "session-a",
        capability: "users.write",
        capabilityGroupKey: null,
      }],
      {
        kind: "cli",
        contractId: "core@v1",
        sessionPublicKey: "session-b",
      },
    ),
    EMPTY_BOUNDARY,
  );
});

Deno.test("capability-group grant overrides resolve current group capabilities", async () => {
  const effective = await applyGrantOverrideCapabilities(
    EMPTY_BOUNDARY,
    [{
      deploymentId: "app-a",
      identityKind: "web",
      grantKind: "capability-group",
      contractId: "core@v1",
      origin: "https://app.example",
      sessionPublicKey: null,
      capability: null,
      capabilityGroupKey: "operators",
    }],
    { kind: "web", contractId: "core@v1", origin: "https://app.example" },
    {
      get: async (groupKey) =>
        groupKey === "operators"
          ? {
            groupKey,
            displayName: "Operators",
            description: "Current operator grants.",
            capabilities: ["users.read", "users.write"],
            includedGroups: [],
            createdAt: "2026-05-19T00:00:00.000Z",
            updatedAt: "2026-05-19T00:00:00.000Z",
          }
          : undefined,
    },
  );

  assertEquals(
    effective,
    boundary({ capabilities: ["users.read", "users.write"] }),
  );
});

Deno.test("boundaryToDeploymentEnvelopeRows emits stable modeled child rows", () => {
  assertEquals(boundaryToDeploymentEnvelopeRows("svc-a", fullEnvelope), {
    contracts: [{
      deploymentId: "svc-a",
      contractId: "core@v1",
      required: true,
    }],
    surfaces: [{
      deploymentId: "svc-a",
      contractId: "core@v1",
      kind: "rpc",
      name: "Users.Get",
      action: "call",
      required: true,
    }],
    capabilities: [{ deploymentId: "svc-a", capability: "users.read" }],
    resources: [{
      deploymentId: "svc-a",
      kind: "kv",
      alias: "sessions",
      required: true,
    }],
  });
});

Deno.test("previewEnvelopeShrinkImpact reports boundaries and resources no longer covered", () => {
  const proposed = boundary({
    contracts: [{ contractId: "core@v1", required: true }],
    surfaces: [],
    capabilities: [],
    resources: [],
  });

  assertEquals(
    previewEnvelopeShrinkImpact({
      current: fullEnvelope,
      proposed,
      dependents: [{
        kind: "service-instance",
        id: "instance-a",
        boundary: fullEnvelope,
      }],
      resourceBindings: [{ kind: "kv", alias: "sessions" }],
      pendingRequests: [{ requestId: "req-a", delta: fullEnvelope }],
    }),
    {
      removed: boundary({
        surfaces: [{
          contractId: "core@v1",
          kind: "rpc",
          name: "Users.Get",
          action: "call",
          required: true,
        }],
        capabilities: ["users.read"],
        resources: [{ kind: "kv", alias: "sessions", required: true }],
      }),
      impactedDependents: [{
        kind: "service-instance",
        id: "instance-a",
        missing: boundary({
          surfaces: [{
            contractId: "core@v1",
            kind: "rpc",
            name: "Users.Get",
            action: "call",
            required: true,
          }],
          capabilities: ["users.read"],
          resources: [{ kind: "kv", alias: "sessions", required: true }],
        }),
      }],
      orphanedResources: [{ kind: "kv", alias: "sessions" }],
      impactedPendingRequests: [{
        requestId: "req-a",
        missing: boundary({
          surfaces: [{
            contractId: "core@v1",
            kind: "rpc",
            name: "Users.Get",
            action: "call",
            required: true,
          }],
          capabilities: ["users.read"],
          resources: [{ kind: "kv", alias: "sessions", required: true }],
        }),
      }],
    },
  );
});
