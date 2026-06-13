import { assertEquals } from "@std/assert";

import {
  applyGrantOverrideAuthorityCapabilities,
  authorityNeedsToDeploymentAuthorityRows,
  computeAuthorityNeedsDelta,
  evaluateProposalNeedsFit,
  previewAuthorityReductionImpact,
} from "./authority_needs_decision.ts";
import { emptyAuthorityNeeds, mergeAuthorityNeeds } from "./authority_needs.ts";
import type {
  AuthorityNeedSet,
  DeploymentAuthorityGrantOverride,
} from "./schemas.ts";

const EMPTY_AUTHORITY_NEEDS: AuthorityNeedSet = {
  contracts: [],
  surfaces: [],
  capabilities: [],
  resources: [],
};

function needs(overrides: Partial<AuthorityNeedSet>): AuthorityNeedSet {
  return {
    contracts: [],
    surfaces: [],
    capabilities: [],
    resources: [],
    ...overrides,
  };
}

function cap(capability: string, required = true) {
  return { capability, required };
}

const fullAuthority = needs({
  contracts: [{ contractId: "core@v1", required: true }],
  surfaces: [{
    contractId: "core@v1",
    kind: "rpc",
    name: "Users.Get",
    action: "call",
    required: true,
  }],
  capabilities: [cap("users.read")],
  resources: [{ kind: "kv", alias: "sessions", required: true }],
});

Deno.test("mergeAuthorityNeeds normalizes grouped capability needs", () => {
  assertEquals(
    mergeAuthorityNeeds(
      needs({
        capabilities: [cap("z.read", false), cap("a.read")],
      }),
      needs({
        capabilities: [cap("z.read")],
      }),
      emptyAuthorityNeeds(),
    ),
    needs({
      capabilities: [cap("a.read"), cap("z.read")],
    }),
  );
});

Deno.test("evaluateProposalNeedsFit separates missing availability from missing capabilities", () => {
  const requested = needs({
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
    capabilities: [cap("billing.export"), cap("users.read")],
    resources: [{ kind: "kv", alias: "sessions", required: true }],
  });

  assertEquals(evaluateProposalNeedsFit(fullAuthority, requested), {
    fits: false,
    missingAvailability: needs({
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

Deno.test("computeAuthorityNeedsDelta returns only unavailable rows and missing capabilities", () => {
  const requested = needs({
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
    capabilities: [cap("events.read"), cap("users.read")],
    resources: [
      { kind: "kv", alias: "sessions", required: true },
      { kind: "store", alias: "exports", required: false },
    ],
  });

  assertEquals(
    computeAuthorityNeedsDelta(fullAuthority, requested),
    needs({
      contracts: [{ contractId: "optional@v1", required: false }],
      surfaces: [{
        contractId: "optional@v1",
        kind: "event",
        name: "Events.Created",
        action: "subscribe",
        required: false,
      }],
      capabilities: [cap("events.read")],
      resources: [{ kind: "store", alias: "exports", required: false }],
    }),
  );
});

Deno.test("grant overrides add capabilities only for matching identities", async () => {
  const grants: DeploymentAuthorityGrantOverride[] = [
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
    await applyGrantOverrideAuthorityCapabilities(
      EMPTY_AUTHORITY_NEEDS,
      grants,
      {
        kind: "web",
        contractId: "core@v1",
        origin: "https://app.example",
      },
    ),
    needs({ capabilities: [cap("users.write")] }),
  );

  assertEquals(
    await applyGrantOverrideAuthorityCapabilities(
      EMPTY_AUTHORITY_NEEDS,
      grants,
      {
        kind: "cli",
        contractId: "core@v1",
        sessionPublicKey: "session-a",
      },
    ),
    needs({ capabilities: [cap("users.read")] }),
  );

  assertEquals(
    await applyGrantOverrideAuthorityCapabilities(
      EMPTY_AUTHORITY_NEEDS,
      grants,
      {
        kind: "web",
        contractId: "core@v1",
        origin: "https://other.example",
      },
    ),
    EMPTY_AUTHORITY_NEEDS,
  );
});

Deno.test("grant overrides do not invent authority availability", async () => {
  const effective = await applyGrantOverrideAuthorityCapabilities(
    needs({ capabilities: [cap("users.read")] }),
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
    evaluateProposalNeedsFit(
      effective,
      needs({
        surfaces: [{
          contractId: "billing@v1",
          kind: "operation",
          name: "Invoices.Export",
          action: "call",
          required: true,
        }],
        capabilities: [cap("billing.export")],
      }),
    ),
    {
      fits: false,
      missingAvailability: needs({
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
    await applyGrantOverrideAuthorityCapabilities(
      EMPTY_AUTHORITY_NEEDS,
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
    EMPTY_AUTHORITY_NEEDS,
  );
});

Deno.test("capability-group grant overrides resolve current group capabilities", async () => {
  const effective = await applyGrantOverrideAuthorityCapabilities(
    EMPTY_AUTHORITY_NEEDS,
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
    needs({ capabilities: [cap("users.read"), cap("users.write")] }),
  );
});

Deno.test("authorityNeedsToDeploymentAuthorityRows emits stable modeled child rows", () => {
  assertEquals(
    authorityNeedsToDeploymentAuthorityRows("svc-a", fullAuthority),
    {
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
    },
  );
});

Deno.test("previewAuthorityReductionImpact reports needs and resources no longer covered", () => {
  const proposed = needs({
    contracts: [{ contractId: "core@v1", required: true }],
    surfaces: [],
    capabilities: [],
    resources: [],
  });

  assertEquals(
    previewAuthorityReductionImpact({
      current: fullAuthority,
      proposed,
      dependents: [{
        kind: "service-instance",
        id: "instance-a",
        needs: fullAuthority,
      }],
      resourceBindings: [{ kind: "kv", alias: "sessions" }],
      pendingRequests: [{ requestId: "req-a", delta: fullAuthority }],
    }),
    {
      removed: needs({
        surfaces: [{
          contractId: "core@v1",
          kind: "rpc",
          name: "Users.Get",
          action: "call",
          required: true,
        }],
        capabilities: [cap("users.read")],
        resources: [{ kind: "kv", alias: "sessions", required: true }],
      }),
      impactedDependents: [{
        kind: "service-instance",
        id: "instance-a",
        missing: needs({
          surfaces: [{
            contractId: "core@v1",
            kind: "rpc",
            name: "Users.Get",
            action: "call",
            required: true,
          }],
          capabilities: [cap("users.read")],
          resources: [{ kind: "kv", alias: "sessions", required: true }],
        }),
      }],
      orphanedResources: [{ kind: "kv", alias: "sessions" }],
      impactedPendingRequests: [{
        requestId: "req-a",
        missing: needs({
          surfaces: [{
            contractId: "core@v1",
            kind: "rpc",
            name: "Users.Get",
            action: "call",
            required: true,
          }],
          capabilities: [cap("users.read")],
          resources: [{ kind: "kv", alias: "sessions", required: true }],
        }),
      }],
    },
  );
});
