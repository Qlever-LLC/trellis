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
    deploymentContractEvidence: [
      {
        deploymentId: "service.enabled",
        contractId: "service@v1",
        contractDigest: "service-digest",
      },
      {
        deploymentId: "service.disabled",
        contractId: "disabled@v1",
        contractDigest: "disabled-parent-digest",
      },
      {
        deploymentId: "device.enabled",
        contractId: "device@v1",
        contractDigest: "device-digest",
      },
    ],
  });

  assertEquals([...active], ["builtin"]);
});

Deno.test("collectActiveContractDigests ignores enabled deployment evidence", () => {
  const active = collectActiveContractDigests({
    builtinDigests: [],
    deploymentEnvelopes: [envelope("service.enabled", ["service@v1"])],
    deploymentContractEvidence: [{
      deploymentId: "service.enabled",
      contractId: "service@v1",
      contractDigest: "service-digest",
    }],
  });

  assertEquals([...active], []);
});

Deno.test("collectActiveContractDigests excludes disabled service deployment evidence", () => {
  const active = collectActiveContractDigests({
    builtinDigests: [],
    deploymentEnvelopes: [envelope("service.disabled", ["service@v1"], true)],
    deploymentContractEvidence: [{
      deploymentId: "service.disabled",
      contractId: "service@v1",
      contractDigest: "service-digest",
    }],
  });

  assertEquals([...active], []);
});

Deno.test("collectActiveContractDigests ignores non-builtin evidence while preserving builtin digests", () => {
  const active = collectActiveContractDigests({
    builtinDigests: ["builtin-current"],
    builtinContractIds: ["trellis.jobs@v1"],
    deploymentEnvelopes: [
      envelope("service.jobs", ["trellis.jobs@v1", "app@v1"]),
    ],
    deploymentContractEvidence: [
      {
        deploymentId: "service.jobs",
        contractId: "trellis.jobs@v1",
        contractDigest: "builtin-old",
      },
      {
        deploymentId: "service.jobs",
        contractId: "app@v1",
        contractDigest: "app-digest",
      },
    ],
  });

  assertEquals([...active], ["builtin-current"]);
});
