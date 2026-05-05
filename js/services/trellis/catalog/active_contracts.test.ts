import { assertEquals } from "@std/assert";

import {
  addDeploymentAllowedDigests,
  collectActiveContractDigests,
  overlayStagedRecords,
} from "./active_contracts.ts";

Deno.test("addDeploymentAllowedDigests includes every active deployment digest", () => {
  const active = new Set<string>(["builtin"]);

  addDeploymentAllowedDigests(
    active,
    [
      {
        disabled: false,
        appliedContracts: [
          {
            contractId: "service-a@v1",
            allowedDigests: ["digest-a", "digest-b"],
          },
          { contractId: "service-b@v1", allowedDigests: ["digest-c"] },
        ],
      },
      {
        disabled: true,
        appliedContracts: [{
          contractId: "service-c@v1",
          allowedDigests: ["digest-d"],
        }],
      },
      { disabled: false, appliedContracts: [] },
    ],
    (deployment) => !deployment.disabled,
  );

  assertEquals([...active].sort(), [
    "builtin",
    "digest-a",
    "digest-b",
    "digest-c",
  ]);
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
    serviceDeployments: [
      {
        deploymentId: "service.enabled",
        disabled: false,
        appliedContracts: [{
          contractId: "service@v1",
          allowedDigests: ["service-digest"],
        }],
      },
      {
        deploymentId: "service.disabled",
        disabled: true,
        appliedContracts: [{
          contractId: "disabled@v1",
          allowedDigests: ["disabled-parent-digest"],
        }],
      },
    ],
    deviceDeployments: [
      {
        deploymentId: "device.enabled",
        disabled: false,
        appliedContracts: [{
          contractId: "device@v1",
          allowedDigests: ["device-digest"],
        }],
      },
    ],
  });

  assertEquals([...active].sort(), [
    "builtin",
    "device-digest",
    "service-digest",
  ]);
});

Deno.test("collectActiveContractDigests includes enabled service deployment allowed digests without instances", () => {
  const active = collectActiveContractDigests({
    builtinDigests: [],
    serviceDeployments: [{
      deploymentId: "service.enabled",
      disabled: false,
      appliedContracts: [{
        contractId: "service@v1",
        allowedDigests: ["service-digest"],
      }],
    }],
    deviceDeployments: [],
  });

  assertEquals([...active], ["service-digest"]);
});

Deno.test("collectActiveContractDigests excludes disabled service deployment allowed digests", () => {
  const active = collectActiveContractDigests({
    builtinDigests: [],
    serviceDeployments: [{
      deploymentId: "service.disabled",
      disabled: true,
      appliedContracts: [{
        contractId: "service@v1",
        allowedDigests: ["service-digest"],
      }],
    }],
    deviceDeployments: [],
  });

  assertEquals([...active], []);
});

Deno.test("collectActiveContractDigests skips deployment digests for built-in lineages", () => {
  const active = collectActiveContractDigests({
    builtinDigests: ["builtin-current"],
    builtinContractIds: ["trellis.jobs@v1"],
    serviceDeployments: [{
      deploymentId: "service.jobs",
      disabled: false,
      appliedContracts: [{
        contractId: "trellis.jobs@v1",
        allowedDigests: ["builtin-old"],
      }, {
        contractId: "app@v1",
        allowedDigests: ["app-digest"],
      }],
    }],
    deviceDeployments: [],
  });

  assertEquals([...active].sort(), ["app-digest", "builtin-current"]);
});
