import { assertEquals } from "@std/assert";

import {
  type ActiveDeploymentEnvelopeRecord,
  collectActiveContractDigests,
  overlayStagedRecords,
} from "./active_contracts.ts";

function envelope(
  deploymentId: string,
  contractIds: string[],
  disabled = false,
): ActiveDeploymentEnvelopeRecord {
  return {
    deploymentId,
    disabled,
    boundary: {
      contracts: contractIds.map((contractId) => ({ contractId })),
      surfaces: [],
    },
  };
}

Deno.test("overlayStagedRecords replaces persisted records by key", () => {
  const records = overlayStagedRecords(
    [
      { id: "a", value: "persisted-a" },
      { id: "b", value: "persisted-b" },
    ],
    [
      { id: "b", value: "staged-b" },
      { id: "c", value: "staged-c" },
    ],
    (record) => record.id,
  );

  assertEquals(records, [
    { id: "a", value: "persisted-a" },
    { id: "b", value: "staged-b" },
    { id: "c", value: "staged-c" },
  ]);
});

Deno.test("collectActiveContractDigests keeps builtins active", () => {
  const active = collectActiveContractDigests({
    builtinDigests: ["builtin"],
    builtinContractIds: ["trellis.core@v1"],
    deploymentEnvelopes: [
      envelope("service.enabled", ["service@v1"]),
      envelope("service.disabled", ["disabled@v1"], true),
      envelope("device.enabled", ["device@v1"]),
    ],
  });

  assertEquals([...active], ["builtin"]);
});

Deno.test("collectActiveContractDigests ignores enabled deployment envelopes", () => {
  const active = collectActiveContractDigests({
    builtinDigests: [],
    deploymentEnvelopes: [envelope("service.enabled", ["service@v1"])],
  });

  assertEquals([...active], []);
});

Deno.test("collectActiveContractDigests excludes disabled service deployment envelopes", () => {
  const active = collectActiveContractDigests({
    builtinDigests: [],
    deploymentEnvelopes: [envelope("service.disabled", ["service@v1"], true)],
  });

  assertEquals([...active], []);
});

Deno.test("collectActiveContractDigests preserves builtin digests", () => {
  const active = collectActiveContractDigests({
    builtinDigests: ["builtin-current"],
    builtinContractIds: ["trellis.jobs@v1"],
    deploymentEnvelopes: [
      envelope("service.jobs", ["trellis.jobs@v1", "app@v1"]),
    ],
  });

  assertEquals([...active], ["builtin-current"]);
});

Deno.test("collectActiveContractDigests includes accepted non-expired implementation offers", () => {
  const active = collectActiveContractDigests({
    builtinDigests: ["builtin-current"],
    deploymentEnvelopes: [],
    evaluationTime: "2026-01-01T00:00:00.000Z",
    implementationOffers: [{
      deploymentKind: "service",
      deploymentId: "service.default",
      instanceId: "svc_1",
      contractId: "service@v1",
      contractDigest: "service-digest",
      status: "accepted",
      acceptedAt: "2025-12-31T00:00:00.000Z",
      firstOfferedAt: "2025-12-31T00:00:00.000Z",
      lastRefreshedAt: "2026-01-01T00:00:00.000Z",
      staleAt: null,
      expiresAt: null,
    }],
  });

  assertEquals([...active], ["builtin-current", "service-digest"]);
});

Deno.test("collectActiveContractDigests excludes offered stale expired and withdrawn offers", () => {
  const active = collectActiveContractDigests({
    builtinDigests: [],
    deploymentEnvelopes: [],
    evaluationTime: "2026-01-01T00:00:00.000Z",
    implementationOffers: [
      {
        deploymentKind: "service",
        deploymentId: "service.offered",
        instanceId: null,
        contractId: "service@v1",
        contractDigest: "offered-digest",
        status: "offered",
        acceptedAt: null,
        firstOfferedAt: "2025-12-31T00:00:00.000Z",
        lastRefreshedAt: "2025-12-31T00:00:00.000Z",
        staleAt: null,
        expiresAt: null,
      },
      {
        deploymentKind: "service",
        deploymentId: "service.stale",
        instanceId: "svc_stale",
        contractId: "service@v1",
        contractDigest: "stale-digest",
        status: "accepted",
        acceptedAt: "2025-12-31T00:00:00.000Z",
        firstOfferedAt: "2025-12-31T00:00:00.000Z",
        lastRefreshedAt: "2025-12-31T00:00:00.000Z",
        staleAt: "2025-12-31T23:00:00.000Z",
        expiresAt: null,
      },
      {
        deploymentKind: "service",
        deploymentId: "service.expired",
        instanceId: "svc_expired",
        contractId: "service@v1",
        contractDigest: "expired-digest",
        status: "accepted",
        acceptedAt: "2025-12-31T00:00:00.000Z",
        firstOfferedAt: "2025-12-31T00:00:00.000Z",
        lastRefreshedAt: "2025-12-31T00:00:00.000Z",
        staleAt: null,
        expiresAt: "2025-12-31T23:00:00.000Z",
      },
      {
        deploymentKind: "service",
        deploymentId: "service.withdrawn",
        instanceId: "svc_withdrawn",
        contractId: "service@v1",
        contractDigest: "withdrawn-digest",
        status: "withdrawn",
        acceptedAt: "2025-12-31T00:00:00.000Z",
        firstOfferedAt: "2025-12-31T00:00:00.000Z",
        lastRefreshedAt: "2025-12-31T00:00:00.000Z",
        staleAt: null,
        expiresAt: null,
      },
    ],
  });

  assertEquals([...active], []);
});
