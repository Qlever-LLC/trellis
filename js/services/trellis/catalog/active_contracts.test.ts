import { assertEquals } from "@std/assert";

import {
  addCurrentContractDigests,
  addDeploymentAllowedDigests,
} from "./active_contracts.ts";

Deno.test("addCurrentContractDigests includes concrete active instance digests", () => {
  const active = new Set<string>(["builtin"]);

  addCurrentContractDigests(
    active,
    [
      { disabled: false, currentContractDigest: "digest-a" },
      { disabled: false, currentContractDigest: "digest-b" },
      { disabled: true, currentContractDigest: "digest-c" },
      { disabled: false },
    ],
    (instance) => !instance.disabled,
  );

  assertEquals([...active].sort(), [
    "builtin",
    "digest-a",
    "digest-b",
  ]);
});

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
