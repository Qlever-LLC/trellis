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
          { allowedDigests: ["digest-a", "digest-b"] },
          { allowedDigests: ["digest-c"] },
        ],
      },
      {
        disabled: true,
        appliedContracts: [{ allowedDigests: ["digest-d"] }],
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
    serviceDeployments: [
      {
        deploymentId: "service.enabled",
        disabled: false,
        appliedContracts: [{ allowedDigests: ["service-digest"] }],
      },
      {
        deploymentId: "service.disabled",
        disabled: true,
        appliedContracts: [{ allowedDigests: ["disabled-parent-digest"] }],
      },
    ],
    deviceDeployments: [
      {
        deploymentId: "device.enabled",
        disabled: false,
        appliedContracts: [{ allowedDigests: ["device-digest"] }],
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
      appliedContracts: [{ allowedDigests: ["service-digest"] }],
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
      appliedContracts: [{ allowedDigests: ["service-digest"] }],
    }],
    deviceDeployments: [],
  });

  assertEquals([...active], []);
});
