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

Deno.test("grant overrides add capabilities only for matching identities", () => {
  const grants: DeploymentGrantOverride[] = [
    {
      deploymentId: "app-a",
      identityKind: "web",
      contractId: "core@v1",
      origin: "https://app.example",
      sessionPublicKey: null,
      devicePublicKey: null,
      capability: "users.write",
    },
    {
      deploymentId: "app-a",
      identityKind: "any",
      contractId: null,
      origin: null,
      sessionPublicKey: null,
      devicePublicKey: null,
      capability: "users.read",
    },
  ];

  assertEquals(
    applyGrantOverrideCapabilities(EMPTY_BOUNDARY, grants, {
      kind: "web",
      contractId: "core@v1",
      origin: "https://app.example",
    }),
    boundary({ capabilities: ["users.read", "users.write"] }),
  );

  assertEquals(
    applyGrantOverrideCapabilities(EMPTY_BOUNDARY, grants, {
      kind: "web",
      contractId: "core@v1",
      origin: "https://other.example",
    }),
    boundary({ capabilities: ["users.read"] }),
  );
});

Deno.test("grant overrides do not invent envelope availability", () => {
  const effective = applyGrantOverrideCapabilities(
    boundary({ capabilities: ["users.read"] }),
    [{
      deploymentId: "app-a",
      identityKind: "any",
      contractId: null,
      origin: null,
      sessionPublicKey: null,
      devicePublicKey: null,
      capability: "billing.export",
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

Deno.test("grant override matching requires every provided discriminator", () => {
  assertEquals(
    applyGrantOverrideCapabilities(
      EMPTY_BOUNDARY,
      [{
        deploymentId: "app-a",
        identityKind: "web",
        contractId: "core@v1",
        origin: "https://app.example",
        sessionPublicKey: "session-a",
        devicePublicKey: null,
        capability: "users.write",
      }],
      {
        kind: "web",
        contractId: "core@v1",
        origin: "https://app.example",
      },
    ),
    EMPTY_BOUNDARY,
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
