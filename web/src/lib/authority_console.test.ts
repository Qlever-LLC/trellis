import { deepEqual, equal } from "node:assert/strict";

import type {
  DeploymentAuthority,
  DeploymentAuthorityPlan,
  DeploymentAuthorityPlanBreakingChange,
} from "@qlever-llc/trellis/auth";
import {
  applyBreakingChanges,
  type AuthorityCapabilityDefinition,
  authorityCounts,
  authorityPlanRows,
  AuthoritySelectionGuard,
  chooseSelectedAuthorityPlan,
  chooseSelectedDeployment,
  contractManifestDiffRows,
  createsCapabilityRows,
  deltaCapabilityRows,
  deltaContractRows,
  deltaResourceRows,
  deltaSurfaceRows,
  deploymentAuthorityRows,
  deviceRuntimeDeployments,
  formatBindingTarget,
  givenCapabilityRows,
  livenessRows,
  type PlanSummaryEntry,
  type PlanSummaryGroup,
  serviceRuntimeDeployments,
} from "./authority_console.ts";

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
type AuthorityMaterialization = NonNullable<
  Parameters<typeof givenCapabilityRows>[1]
>;

const desiredState: DeploymentAuthority["desiredState"] = {
  needs: {
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
    resources: [{ kind: "kv", alias: "cache", required: true }],
    capabilities: [
      { capability: "billing.read", required: true },
      { capability: "billing.events", required: false },
    ],
  },
  capabilities: ["billing.read", "billing.events"],
  resources: [{ kind: "kv", alias: "cache", required: true }],
  surfaces: [
    {
      contractId: "acme.billing@v1",
      kind: "rpc",
      name: "Invoice.Get",
      action: "call",
    },
    {
      contractId: "acme.billing@v1",
      kind: "event",
      name: "Invoice.Updated",
      action: "subscribe",
    },
  ],
};

const healthPublishState: DeploymentAuthority["desiredState"] = {
  needs: {
    contracts: [],
    surfaces: [{
      contractId: "trellis.health@v1",
      kind: "event",
      name: "Health.StatusChanged",
      action: "publish",
      required: true,
    }],
    resources: [],
    capabilities: [],
  },
  capabilities: [],
  resources: [],
  surfaces: [{
    contractId: "trellis.health@v1",
    kind: "event",
    name: "Health.StatusChanged",
    action: "publish",
  }],
};

function authority(
  overrides: Partial<DeploymentAuthority> = {},
): DeploymentAuthority {
  return {
    deploymentId: "billing.default",
    kind: "service",
    disabled: false,
    desiredState,
    version: "v1",
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
    ...overrides,
  };
}

function authorityPlan(
  overrides: Partial<
    Extract<DeploymentAuthorityPlan, { classification: "update" }>
  > = {},
): DeploymentAuthorityPlan {
  return {
    planId: "plan-1",
    deploymentId: "billing.default",
    classification: "update",
    proposal: {
      deploymentId: "billing.default",
      contractId: "acme.billing@v1",
      contractDigest: "digest-1",
      contract: {},
      requestedNeeds: desiredState.needs,
      providedSurfaces: [],
    },
    desiredChange: {
      contracts: [{ contractId: "acme.billing@v1", required: true }],
      surfaces: [{
        contractId: "acme.billing@v1",
        kind: "rpc",
        name: "Invoice.Get",
        action: "call",
        required: true,
      }, {
        contractId: "acme.billing@v1",
        kind: "event",
        name: "Invoice.Updated",
        action: "subscribe",
        required: false,
      }],
      resources: [{ kind: "kv", alias: "cache", required: true }],
      capabilities: [
        { capability: "billing.read", required: true },
        { capability: "billing.events", required: false },
      ],
    },
    materializationPreview: {},
    breakingChanges: [],
    createdAt: "2026-05-07T00:00:00.000Z",
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

function materializedAuthority(
  overrides: Partial<AuthorityMaterialization> = {},
): AuthorityMaterialization {
  return {
    deploymentId: "billing.default",
    desiredVersion: "v1",
    status: "current",
    resourceBindings: [],
    grants: {
      capabilities: [{ capability: "billing.read" }],
      surfaces: [],
      nats: [],
    },
    reconciledAt: "2026-05-07T00:00:00.000Z",
    ...overrides,
  };
}

const capabilityDefinitions: AuthorityCapabilityDefinition[] = [{
  deploymentId: "billing.default",
  key: "billing.create-invoices",
  displayName: "Create invoices",
  description: "Allows other participants to request invoice creation.",
  consequence: "Can create billable records.",
  source: "contract",
  contractId: "acme.billing@v1",
  contractDigest: "digest-1",
  contractDisplayName: "Acme Billing",
  direction: "creates",
}, {
  deploymentId: "billing.default",
  key: "billing.read",
  displayName: "Read billing data",
  description: "Allows this deployment to read billing data.",
  source: "contract",
  contractId: "acme.billing@v1",
  contractDigest: "digest-1",
  contractDisplayName: "Acme Billing",
  direction: "given",
}, {
  deploymentId: "billing.default",
  key: "billing.events",
  displayName: "Observe billing events",
  description: "Allows this deployment to subscribe to billing events.",
  source: "contract",
  contractId: "acme.billing@v1",
  contractDigest: "digest-1",
  contractDisplayName: "Acme Billing",
  direction: "given",
}, {
  deploymentId: "orders.default",
  key: "orders.create",
  displayName: "Create orders",
  description: "Out-of-scope deployment definition.",
  source: "contract",
  direction: "creates",
}];

Deno.test("deploymentAuthorityRows summarizes desired authority", () => {
  deepEqual(deploymentAuthorityRows([authority()]), [{
    deploymentId: "billing.default",
    kind: "service",
    status: "Active",
    desiredVersion: "v1",
    requiredContracts: 1,
    optionalContracts: 0,
    surfaces: 2,
    resources: 1,
    capabilities: 2,
    updatedAt: "2026-05-07T00:00:00.000Z",
  }]);
});

Deno.test("authorityCounts separates required and optional requested needs", () => {
  deepEqual(authorityCounts(desiredState), {
    requiredContracts: 1,
    optionalContracts: 0,
    requiredSurfaces: 1,
    optionalSurfaces: 1,
    requiredResources: 1,
    optionalResources: 0,
    requiredCapabilities: 1,
    optionalCapabilities: 1,
    capabilities: 2,
  });
});

Deno.test("authorityPlanRows exposes update and migration counts", () => {
  const rows = authorityPlanRows([authorityPlan()]);

  deepEqual(rows[0], {
    planId: "plan-1",
    deploymentId: "billing.default",
    state: "pending",
    classification: "update",
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
      "plan-1 billing.default update acme.billing@v1 digest-1 acme.billing@v1 required acme.billing@v1 rpc invoice.get call acme.billing@v1 event invoice.updated subscribe kv cache billing.read billing.events",
  });
});

Deno.test("delta display helpers preserve exact authority needs", () => {
  deepEqual(deltaContractRows(desiredState), [{
    id: "acme.billing@v1",
    contractId: "acme.billing@v1",
    availability: "required",
  }]);
  deepEqual(deltaSurfaceRows(desiredState), [{
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
  deepEqual(deltaResourceRows(desiredState), [{
    id: "kv:cache",
    kind: "kv",
    alias: "cache",
    availability: "required",
  }]);
  deepEqual(deltaCapabilityRows(desiredState), [{
    id: "billing.read",
    capability: "billing.read",
    availability: "required",
  }, {
    id: "billing.events",
    capability: "billing.events",
    availability: "optional",
  }]);
});

Deno.test("contractManifestDiffRows shows schema-only contract changes", () => {
  const oldContract = {
    format: "trellis.api.v1",
    id: "acme.billing@v1",
    displayName: "Acme Billing",
    description: "Billing contract",
    kind: "service",
    schemas: {
      SyncJobPayload: { type: "object", required: ["id"] },
    },
    jobs: { Sync: { payload: { schema: "SyncJobPayload" } } },
  };
  const newContract = {
    ...oldContract,
    schemas: {
      SyncJobPayload: { type: "object", required: ["id", "cursor"] },
    },
  };

  deepEqual(contractManifestDiffRows(oldContract, newContract).schemas, [{
    id: "schemas:SyncJobPayload",
    change: "Change",
    kind: "Schema",
    name: "SyncJobPayload",
    detail: "required fields: +cursor",
    before: oldContract.schemas.SyncJobPayload,
    after: newContract.schemas.SyncJobPayload,
  }]);
});

Deno.test("contractManifestDiffRows summarizes docs and capability changes", () => {
  const oldContract = {
    id: "acme.billing@v1",
    docs: { summary: "Creates invoices." },
    capabilities: {
      "billing.read": { description: "Read invoices." },
    },
  };
  const newContract = {
    id: "acme.billing@v1",
    docs: { summary: "Creates and syncs invoices." },
    capabilities: {
      "billing.read": { description: "Read invoices and sync status." },
      "billing.write": { description: "Write invoices." },
    },
  };
  const rows = contractManifestDiffRows(oldContract, newContract);

  deepEqual(rows.contracts, [{
    id: "docs:summary",
    change: "Change",
    kind: "Docs",
    name: "summary",
    detail: "Creates invoices. -> Creates and syncs invoices.",
    before: "Creates invoices.",
    after: "Creates and syncs invoices.",
  }]);
  deepEqual(rows.capabilities, [{
    id: "capabilities:billing.read",
    change: "Change",
    kind: "Capability",
    name: "billing.read",
    detail: "description: Read invoices. -> Read invoices and sync status.",
    before: oldContract.capabilities["billing.read"],
    after: newContract.capabilities["billing.read"],
  }, {
    id: "capabilities:billing.write",
    change: "Add",
    kind: "Capability",
    name: "billing.write",
    detail: "Write invoices.",
    before: null,
    after: newContract.capabilities["billing.write"],
  }]);
});

Deno.test("createsCapabilityRows returns deployment-owned Creates definitions", () => {
  deepEqual(createsCapabilityRows(authority(), capabilityDefinitions), [{
    id:
      "billing.default:creates:billing.create-invoices:acme.billing@v1:digest-1",
    capability: "billing.create-invoices",
    displayName: "Create invoices",
    description: "Allows other participants to request invoice creation.",
    consequence: "Can create billable records.",
    source: "contract",
    contractId: "acme.billing@v1",
    contractDigest: "digest-1",
    contractDisplayName: "Acme Billing",
  }]);
});

Deno.test("givenCapabilityRows combines Given needs and materialized grants", () => {
  deepEqual(
    givenCapabilityRows(
      authority(),
      materializedAuthority({
        grants: {
          capabilities: [
            { capability: "billing.read" },
            { capability: "billing.admin" },
          ],
          surfaces: [],
          nats: [],
        },
      }),
      capabilityDefinitions,
    ),
    [{
      id: "billing.admin:materialized-only",
      capability: "billing.admin",
      displayName: "billing.admin",
      description: "Accepted deployment authority capability.",
      consequence: null,
      availability: "materialized-only",
      materializedStatus: "granted",
      materializedGrantCount: 1,
      source: "authority",
      contractId: null,
      contractDigest: null,
      contractDisplayName: null,
    }, {
      id: "billing.events:optional",
      capability: "billing.events",
      displayName: "Observe billing events",
      description: "Allows this deployment to subscribe to billing events.",
      consequence: null,
      availability: "optional",
      materializedStatus: "not-materialized",
      materializedGrantCount: 0,
      source: "contract",
      contractId: "acme.billing@v1",
      contractDigest: "digest-1",
      contractDisplayName: "Acme Billing",
    }, {
      id: "billing.read:required",
      capability: "billing.read",
      displayName: "Read billing data",
      description: "Allows this deployment to read billing data.",
      consequence: null,
      availability: "required",
      materializedStatus: "granted",
      materializedGrantCount: 1,
      source: "contract",
      contractId: "acme.billing@v1",
      contractDigest: "digest-1",
      contractDisplayName: "Acme Billing",
    }],
  );
});

Deno.test("givenCapabilityRows reports unknown materialization without details", () => {
  deepEqual(
    givenCapabilityRows(authority(), null, []).map((row) => ({
      capability: row.capability,
      materializedStatus: row.materializedStatus,
    })),
    [{ capability: "billing.events", materializedStatus: "unknown" }, {
      capability: "billing.read",
      materializedStatus: "unknown",
    }],
  );
});

Deno.test("livenessRows reports no live implementer without runtime data", () => {
  deepEqual(
    livenessRows(desiredState, [], "billing.default").map((row) => row.runtime),
    ["no_live_implementer", "no_live_implementer"],
  );
});

Deno.test("livenessRows ignores unaccepted implementation offers", () => {
  deepEqual(
    livenessRows(
      desiredState,
      serviceRuntimeDeployments([implementationOffer({ status: "offered" })]),
      "billing.default",
    ).map((row) => row.runtime),
    ["no_live_implementer", "no_live_implementer"],
  );
});

Deno.test("livenessRows reports live when an accepted implementation offer is active", () => {
  deepEqual(
    livenessRows(
      desiredState,
      serviceRuntimeDeployments([implementationOffer()]),
      "billing.default",
    ).map((row) => row.runtime),
    ["live", "live"],
  );
});

Deno.test("livenessRows treats selected deployment event publishers as live", () => {
  deepEqual(
    livenessRows(
      healthPublishState,
      serviceRuntimeDeployments([
        implementationOffer({ deploymentId: "billing.default" }),
      ]),
      "billing.default",
    ).map((row) => row.runtime),
    ["live"],
  );
});

Deno.test("livenessRows can use live providers from other deployments", () => {
  deepEqual(
    livenessRows(
      desiredState,
      serviceRuntimeDeployments([
        implementationOffer({
          offerId: "offer-orders",
          deploymentId: "orders.default",
        }),
      ]),
      "billing.default",
    ).map((row) => row.runtime),
    ["live", "live"],
  );
});

Deno.test("livenessRows ignores other deployment providers for other contracts", () => {
  deepEqual(
    livenessRows(
      desiredState,
      serviceRuntimeDeployments([
        implementationOffer({
          offerId: "offer-other",
          deploymentId: "orders.default",
          contractId: "other@v1",
        }),
      ]),
      "billing.default",
    ).map((row) => row.runtime),
    ["no_live_implementer", "no_live_implementer"],
  );
});

Deno.test("deviceRuntimeDeployments returns live accepted device implementation offers", () => {
  deepEqual(
    deviceRuntimeDeployments([
      implementationOffer({
        deploymentKind: "device",
        deploymentId: "device.default",
      }),
    ]),
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
      desiredState,
      deviceRuntimeDeployments([
        implementationOffer({
          deploymentKind: "device",
          deploymentId: "billing.default",
          contractId: "other@v1",
          contractDigest: "digest-other",
        }),
      ]),
      "billing.default",
    ).map((row) => row.runtime),
    ["no_live_implementer", "no_live_implementer"],
  );
});

Deno.test("livenessRows scopes runtime to matching surface contracts", () => {
  deepEqual(
    livenessRows(
      desiredState,
      serviceRuntimeDeployments([
        implementationOffer({
          deploymentId: "billing.default",
          contractId: "other@v1",
        }),
      ]),
      "billing.default",
    ).map((row) => row.runtime),
    ["no_live_implementer", "no_live_implementer"],
  );
  deepEqual(
    livenessRows(
      desiredState,
      serviceRuntimeDeployments([
        implementationOffer({ deploymentId: "billing.default" }),
      ]),
      "billing.default",
    ).map((row) => row.runtime),
    ["live", "live"],
  );
});

Deno.test("chooseSelectedDeployment keeps current selection after list refresh", () => {
  const first = authority({ deploymentId: "billing.default" });
  const second = authority({ deploymentId: "orders.default" });

  equal(
    chooseSelectedDeployment([first, second], "orders.default"),
    "orders.default",
  );
  equal(chooseSelectedDeployment([first], "orders.default"), "billing.default");
  equal(chooseSelectedDeployment([], "orders.default"), null);
});

Deno.test("chooseSelectedAuthorityPlan keeps current plan after refresh", () => {
  const first = authorityPlan({ planId: "plan-1" });
  const second = authorityPlan({ planId: "plan-2" });

  equal(chooseSelectedAuthorityPlan([first, second], "plan-2"), "plan-2");
  equal(chooseSelectedAuthorityPlan([first], "plan-2"), "plan-1");
  equal(chooseSelectedAuthorityPlan([], "plan-2"), null);
});

Deno.test("AuthoritySelectionGuard rejects stale selection responses", () => {
  const guard = new AuthoritySelectionGuard();
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

function makeSummaryEntry(
  overrides: Partial<PlanSummaryEntry> = {},
): PlanSummaryEntry {
  return {
    id: "schemas:SyncJobPayload",
    change: "Change",
    kind: "data-shape",
    name: "SyncJobPayload",
    summary: "",
    fields: [{
      kind: "set",
      label: "properties",
      added: [],
      removed: ["mode"],
      kept: ["maxPages", "maxTickets"],
    }],
    breaking: false,
    ...overrides,
  };
}

function makeSummaryGroup(
  entries: PlanSummaryEntry[],
  kind: PlanSummaryGroup["kind"] = "data-shape",
): PlanSummaryGroup[] {
  return [{ kind, label: "Data shapes", entries }];
}

Deno.test("applyBreakingChanges flags schema property removal as breaking", () => {
  const groups = makeSummaryGroup([makeSummaryEntry()]);
  const change: DeploymentAuthorityPlanBreakingChange = {
    kind: "schema-property-removed",
    target: {
      kind: "schema",
      contractId: "acme.billing@v1",
      schemaName: "SyncJobPayload",
    },
    path: "/properties/mode",
    reason: "Property mode removed.",
  };

  const result = applyBreakingChanges(groups, [change]);

  equal(result.groups[0].entries[0].breaking, true);
  const firstField = result.groups[0].entries[0].fields[0];
  equal(firstField.breaking, true);
  equal(firstField.kind === "set" && firstField.removed.includes("mode"), true);
  deepEqual(result.unmatched, []);
});

Deno.test("applyBreakingChanges leaves non-matching entries alone", () => {
  const groups = makeSummaryGroup([makeSummaryEntry({ name: "OtherSchema" })]);
  const change: DeploymentAuthorityPlanBreakingChange = {
    kind: "schema-property-removed",
    target: {
      kind: "schema",
      contractId: "acme.billing@v1",
      schemaName: "SyncJobPayload",
    },
    path: "/properties/mode",
    reason: "Property mode removed.",
  };

  const result = applyBreakingChanges(groups, [change]);

  equal(result.groups[0].entries[0].breaking, false);
  deepEqual(result.unmatched, [change]);
});

Deno.test("applyBreakingChanges matches surface targets by id and kind", () => {
  const groups = makeSummaryGroup(
    [makeSummaryEntry({
      id: "rpc:Invoice.Get",
      name: "Invoice.Get",
      kind: "api",
    })],
    "api",
  );
  const change: DeploymentAuthorityPlanBreakingChange = {
    kind: "surface-subject-changed",
    target: {
      kind: "surface",
      contractId: "acme.billing@v1",
      surfaceKind: "rpc",
      surfaceName: "Invoice.Get",
    },
    reason: "Subject changed.",
  };

  const result = applyBreakingChanges(groups, [change]);

  equal(result.groups[0].entries[0].breaking, true);
  deepEqual(result.unmatched, []);
});

Deno.test("applyBreakingChanges ignores contract and digest targets", () => {
  const groups = makeSummaryGroup([makeSummaryEntry()]);
  const change: DeploymentAuthorityPlanBreakingChange = {
    kind: "digest-incompatible",
    target: {
      kind: "digest",
      contractId: "acme.billing@v1",
      contractDigest: "new-digest",
    },
    reason: "Active compatible digests are incompatible.",
  };

  const result = applyBreakingChanges(groups, [change]);

  equal(result.groups[0].entries[0].breaking, false);
  deepEqual(result.unmatched, [change]);
});

Deno.test("applyBreakingChanges matches capability and resource targets", () => {
  const groups: PlanSummaryGroup[] = [{
    kind: "permission",
    label: "Permissions",
    entries: [makeSummaryEntry({
      id: "capabilities:billing.read",
      name: "billing.read",
      kind: "permission",
      fields: [{
        kind: "scalar",
        label: "description",
        before: "Read invoices.",
        after: "Read invoices and sync status.",
      }],
    })],
  }, {
    kind: "background-job",
    label: "Background jobs and event consumers",
    entries: [makeSummaryEntry({
      id: "jobs:Sync",
      name: "Sync",
      kind: "background-job",
      fields: [{
        kind: "scalar",
        label: "payload",
        before: "OldPayload",
        after: "NewPayload",
        mono: true,
      }],
    })],
  }];

  const capabilityChange: DeploymentAuthorityPlanBreakingChange = {
    kind: "capability-removed",
    target: {
      kind: "capability",
      contractId: "acme.billing@v1",
      capability: "billing.read",
    },
    reason: "Capability removed.",
  };
  const resourceChange: DeploymentAuthorityPlanBreakingChange = {
    kind: "resource-shape-changed",
    target: {
      kind: "resource",
      contractId: "acme.billing@v1",
      resourceAlias: "Sync",
    },
    path: "/payload",
    reason: "Payload schema changed.",
  };

  const result = applyBreakingChanges(groups, [
    capabilityChange,
    resourceChange,
  ]);

  equal(result.groups[0].entries[0].breaking, true);
  equal(result.groups[1].entries[0].breaking, true);
  equal(result.groups[1].entries[0].fields[0].breaking, true);
  deepEqual(result.unmatched, []);
});
