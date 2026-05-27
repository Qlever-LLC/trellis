import { deepEqual, equal } from "node:assert/strict";

import type {
  DeploymentEnvelope,
  EnvelopeBoundary,
} from "../../../../packages/trellis/auth/protocol.ts";
import {
  boundaryCounts,
  chooseSelectedDeployment,
  chooseSelectedExpansionRequest,
  deltaCapabilityRows,
  deltaContractRows,
  deltaResourceRows,
  deltaSurfaceRows,
  deviceRuntimeDeployments,
  envelopeRows,
  EnvelopeSelectionGuard,
  expansionRequestRows,
  formatBindingTarget,
  livenessRows,
  serviceRuntimeDeployments,
} from "./envelope_console.ts";

declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void;
};

type ImplementationOffer = {
  offerId: string;
  deploymentKind: "service" | "device";
  deploymentId: string;
  instanceId: string | null;
  contractId: string;
  contractDigest: string;
  lineageKey: string;
  status: "offered" | "accepted" | "stale" | "expired" | "withdrawn";
  liveness: "unknown" | "healthy" | "unhealthy" | "disconnected";
  firstOfferedAt: string;
  acceptedAt: string | null;
  lastRefreshedAt: string;
  staleAt: string | null;
  expiresAt: string | null;
};

const boundary: EnvelopeBoundary = {
  contracts: [{ contractId: "acme.billing@v1", required: true }],
  surfaces: [
    {
      contractId: "acme.billing@v1",
      kind: "rpc",
      name: "Invoice.Get",
      action: "call",
      required: true,
    },
    {
      contractId: "acme.billing@v1",
      kind: "event",
      name: "Invoice.Updated",
      action: "subscribe",
      required: false,
    },
  ],
  capabilities: ["billing.read", "billing.events"],
  resources: [{ kind: "kv", alias: "cache", required: true }],
};

const healthPublishBoundary: EnvelopeBoundary = {
  contracts: [{ contractId: "trellis.health@v1", required: true }],
  surfaces: [
    {
      contractId: "trellis.health@v1",
      kind: "event",
      name: "Health.Heartbeat",
      action: "publish",
      required: true,
    },
  ],
  capabilities: [],
  resources: [],
};

function envelope(
  overrides: Partial<DeploymentEnvelope> = {},
): DeploymentEnvelope {
  return {
    deploymentId: "billing.default",
    kind: "service",
    disabled: false,
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
    boundary,
    ...overrides,
  };
}

function implementationOffer(
  overrides: Partial<ImplementationOffer> = {},
): ImplementationOffer {
  return {
    offerId: "offer-1",
    deploymentKind: "service",
    deploymentId: "billing.default",
    instanceId: "svc-1",
    contractId: "acme.billing@v1",
    contractDigest: "digest-a",
    lineageKey: "acme.billing@v1",
    status: "accepted",
    liveness: "healthy",
    firstOfferedAt: "2026-05-07T00:00:00.000Z",
    acceptedAt: "2026-05-07T00:00:00.000Z",
    lastRefreshedAt: "2026-05-07T00:00:00.000Z",
    staleAt: null,
    expiresAt: null,
    ...overrides,
  };
}

Deno.test("envelopeRows summarizes deployment envelope authority", () => {
  deepEqual(envelopeRows([envelope()]), [{
    deploymentId: "billing.default",
    kind: "service",
    status: "Active",
    requiredContracts: 1,
    optionalContracts: 0,
    surfaces: 2,
    resources: 1,
    capabilities: 2,
    updatedAt: "2026-05-07T00:00:00.000Z",
  }]);
});

Deno.test("boundaryCounts separates required and optional review deltas", () => {
  deepEqual(boundaryCounts(boundary), {
    requiredContracts: 1,
    optionalContracts: 0,
    requiredSurfaces: 1,
    optionalSurfaces: 1,
    requiredResources: 1,
    optionalResources: 0,
    capabilities: 2,
  });
});

Deno.test("expansionRequestRows exposes request review counts", () => {
  const rows = expansionRequestRows([{
    requestId: "req-1",
    deploymentId: "billing.default",
    requestedByKind: "service",
    requestedBy: { instanceId: "svc-1" },
    contractId: "acme.billing@v1",
    contractDigest: "digest-1",
    contract: {},
    state: "pending",
    createdAt: "2026-05-07T00:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    delta: boundary,
  }]);

  deepEqual(rows[0], {
    requestId: "req-1",
    deploymentId: "billing.default",
    state: "pending",
    requestedByKind: "service",
    contractId: "acme.billing@v1",
    contractDigest: "digest-1",
    requiredContracts: 1,
    optionalContracts: 0,
    requiredSurfaces: 1,
    optionalSurfaces: 1,
    requiredResources: 1,
    optionalResources: 0,
    resources: 1,
    capabilities: 2,
    createdAt: "2026-05-07T00:00:00.000Z",
    searchableText:
      "req-1 billing.default pending service acme.billing@v1 digest-1 acme.billing@v1 acme.billing@v1 rpc invoice.get call acme.billing@v1 event invoice.updated subscribe kv cache billing.read billing.events",
  });
});

Deno.test("delta display helpers preserve exact boundary entries", () => {
  deepEqual(deltaContractRows(boundary), [{
    id: "acme.billing@v1",
    contractId: "acme.billing@v1",
    availability: "required",
  }]);
  deepEqual(deltaSurfaceRows(boundary), [{
    id: "acme.billing@v1:rpc:Invoice.Get:call",
    contractId: "acme.billing@v1",
    kind: "rpc",
    name: "Invoice.Get",
    action: "call",
    availability: "required",
  }, {
    id: "acme.billing@v1:event:Invoice.Updated:subscribe",
    contractId: "acme.billing@v1",
    kind: "event",
    name: "Invoice.Updated",
    action: "subscribe",
    availability: "optional",
  }]);
  deepEqual(deltaResourceRows(boundary), [{
    id: "kv:cache",
    kind: "kv",
    alias: "cache",
    availability: "required",
  }]);
  deepEqual(deltaCapabilityRows(boundary), [{
    id: "billing.read",
    capability: "billing.read",
  }, {
    id: "billing.events",
    capability: "billing.events",
  }]);
});

Deno.test("livenessRows reports no live implementer without runtime data", () => {
  deepEqual(
    livenessRows(boundary, [], "billing.default"),
    [{
      id: "acme.billing@v1:rpc:Invoice.Get:call",
      contractId: "acme.billing@v1",
      surface: "Invoice.Get",
      kind: "rpc",
      action: "call",
      availability: "required",
      runtime: "no_live_implementer",
    }, {
      id: "acme.billing@v1:event:Invoice.Updated:subscribe",
      contractId: "acme.billing@v1",
      surface: "Invoice.Updated",
      kind: "event",
      action: "subscribe",
      availability: "optional",
      runtime: "no_live_implementer",
    }],
  );
});

Deno.test("livenessRows ignores unaccepted implementation offers", () => {
  deepEqual(
    livenessRows(
      boundary,
      serviceRuntimeDeployments([implementationOffer({ status: "offered" })]),
      "billing.default",
    ).map((row) => row.runtime),
    ["no_live_implementer", "no_live_implementer"],
  );
});

Deno.test("livenessRows reports live when an accepted implementation offer is active", () => {
  deepEqual(
    livenessRows(
      boundary,
      serviceRuntimeDeployments([implementationOffer()]),
      "billing.default",
    ),
    [{
      id: "acme.billing@v1:rpc:Invoice.Get:call",
      contractId: "acme.billing@v1",
      surface: "Invoice.Get",
      kind: "rpc",
      action: "call",
      availability: "required",
      runtime: "live",
    }, {
      id: "acme.billing@v1:event:Invoice.Updated:subscribe",
      contractId: "acme.billing@v1",
      surface: "Invoice.Updated",
      kind: "event",
      action: "subscribe",
      availability: "optional",
      runtime: "live",
    }],
  );
});

Deno.test("livenessRows treats selected deployment event publishers as live", () => {
  deepEqual(
    livenessRows(
      healthPublishBoundary,
      serviceRuntimeDeployments([implementationOffer({
        deploymentId: "billing.default",
      })]),
      "billing.default",
    ).map((row) => row.runtime),
    ["live"],
  );
});

Deno.test("livenessRows can use live providers from other deployments", () => {
  deepEqual(
    livenessRows(
      boundary,
      serviceRuntimeDeployments([implementationOffer({
        offerId: "offer-orders",
        deploymentId: "orders.default",
      })]),
      "billing.default",
    ).map((row) => row.runtime),
    ["live", "live"],
  );
});

Deno.test("livenessRows ignores other deployment providers for other contracts", () => {
  deepEqual(
    livenessRows(
      boundary,
      serviceRuntimeDeployments([implementationOffer({
        offerId: "offer-other",
        deploymentId: "orders.default",
        contractId: "other@v1",
      })]),
      "billing.default",
    ).map((row) => row.runtime),
    ["no_live_implementer", "no_live_implementer"],
  );
});

Deno.test("deviceRuntimeDeployments returns live accepted device implementation offers", () => {
  deepEqual(
    deviceRuntimeDeployments([implementationOffer({
      deploymentKind: "device",
      deploymentId: "device.default",
    })]),
    [{
      deploymentId: "device.default",
      contractId: "acme.billing@v1",
      contractDigest: "digest-a",
      disabled: false,
    }],
  );
});

Deno.test("runtime deployment helpers ignore stale and expired accepted offers", () => {
  const now = Date.parse("2026-05-07T00:00:00.000Z");
  deepEqual(
    serviceRuntimeDeployments([
      implementationOffer({
        offerId: "stale",
        staleAt: "2026-05-06T23:59:59.000Z",
      }),
      implementationOffer({
        offerId: "expired",
        expiresAt: "2026-05-06T23:59:59.000Z",
      }),
      implementationOffer({
        offerId: "future",
        expiresAt: "2026-05-07T00:00:01.000Z",
      }),
    ], now),
    [{
      deploymentId: "billing.default",
      contractId: "acme.billing@v1",
      contractDigest: "digest-a",
      disabled: false,
    }],
  );
});

Deno.test("livenessRows does not mark mismatched activated device contracts live", () => {
  deepEqual(
    livenessRows(
      boundary,
      deviceRuntimeDeployments([implementationOffer({
        deploymentKind: "device",
        deploymentId: "billing.default",
        contractId: "other@v1",
        contractDigest: "digest-other",
      })]),
      "billing.default",
    ).map((row) => row.runtime),
    ["no_live_implementer", "no_live_implementer"],
  );
});

Deno.test("livenessRows scopes runtime to matching surface contracts", () => {
  deepEqual(
    livenessRows(
      boundary,
      serviceRuntimeDeployments([implementationOffer({
        deploymentId: "billing.default",
        contractId: "other@v1",
      })]),
      "billing.default",
    ).map((row) => row.runtime),
    ["no_live_implementer", "no_live_implementer"],
  );
  deepEqual(
    livenessRows(
      boundary,
      serviceRuntimeDeployments([implementationOffer({
        deploymentId: "billing.default",
      })]),
      "billing.default",
    ).map((row) => row.runtime),
    ["live", "live"],
  );
});

Deno.test("chooseSelectedDeployment keeps current selection after list refresh", () => {
  const first = envelope({ deploymentId: "billing.default" });
  const second = envelope({ deploymentId: "orders.default" });

  equal(
    chooseSelectedDeployment([first, second], "orders.default"),
    "orders.default",
  );
  equal(chooseSelectedDeployment([first], "orders.default"), "billing.default");
  equal(chooseSelectedDeployment([], "orders.default"), null);
});

Deno.test("chooseSelectedExpansionRequest keeps current request after refresh", () => {
  const first = {
    requestId: "req-1",
    deploymentId: "billing.default",
    requestedByKind: "service",
    requestedBy: { instanceId: "svc-1" },
    contractId: "acme.billing@v1",
    contractDigest: "digest-1",
    contract: {},
    state: "pending",
    createdAt: "2026-05-07T00:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    delta: boundary,
  } as const;
  const second = { ...first, requestId: "req-2" };

  equal(chooseSelectedExpansionRequest([first, second], "req-2"), "req-2");
  equal(chooseSelectedExpansionRequest([first], "req-2"), "req-1");
  equal(chooseSelectedExpansionRequest([], "req-2"), null);
});

Deno.test("EnvelopeSelectionGuard rejects stale selection responses", () => {
  const guard = new EnvelopeSelectionGuard();
  const firstToken = guard.begin("billing.default");
  const secondToken = guard.begin("orders.default");

  equal(guard.shouldCommit("billing.default", firstToken), false);
  equal(guard.shouldCommit("orders.default", firstToken), false);
  equal(guard.shouldCommit("orders.default", secondToken), true);
  equal(guard.selectedDeploymentId, "orders.default");
});

Deno.test("formatBindingTarget displays resource binding identity", () => {
  const binding = {
    deploymentId: "billing.default",
    kind: "kv" as const,
    alias: "cache",
    binding: { bucket: "billing-cache", history: 1 },
    limits: null,
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
  };

  equal(formatBindingTarget(binding), "bucket: billing-cache");
});
