import { assertEquals } from "@std/assert";

import {
  type ActiveDeploymentEnvelopeRecord,
  addDeploymentEvidenceDigests,
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

Deno.test("addDeploymentEvidenceDigests includes every active deployment evidence digest", () => {
  const active = new Set<string>(["builtin"]);

  addDeploymentEvidenceDigests(
    active,
    [
      envelope("service.enabled", ["service-a@v1", "service-b@v1"]),
      envelope("service.disabled", ["service-c@v1"], true),
      envelope("service.empty", []),
    ],
    [
      {
        deploymentId: "service.enabled",
        contractId: "service-a@v1",
        contractDigest: "digest-a",
      },
      {
        deploymentId: "service.enabled",
        contractId: "service-b@v1",
        contractDigest: "digest-b",
      },
      {
        deploymentId: "service.disabled",
        contractId: "service-c@v1",
        contractDigest: "digest-c",
      },
    ],
    (deployment) => !deployment.disabled,
  );

  assertEquals([...active].sort(), ["builtin", "digest-a", "digest-b"]);
});

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

Deno.test("collectActiveContractDigests builds candidate active set", () => {
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

  assertEquals([...active].sort(), [
    "builtin",
    "device-digest",
    "service-digest",
  ]);
});

Deno.test("collectActiveContractDigests includes enabled service deployment evidence without instances", () => {
  const active = collectActiveContractDigests({
    builtinDigests: [],
    deploymentEnvelopes: [envelope("service.enabled", ["service@v1"])],
    deploymentContractEvidence: [{
      deploymentId: "service.enabled",
      contractId: "service@v1",
      contractDigest: "service-digest",
    }],
  });

  assertEquals([...active], ["service-digest"]);
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

Deno.test("collectActiveContractDigests skips deployment evidence for built-in lineages", () => {
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

  assertEquals([...active].sort(), ["app-digest", "builtin-current"]);
});
