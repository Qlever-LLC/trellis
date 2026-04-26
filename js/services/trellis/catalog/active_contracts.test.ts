import { assertEquals } from "@std/assert";

import { addServiceProfileAllowedDigests } from "./active_contracts.ts";

Deno.test("addServiceProfileAllowedDigests includes applied service profile digests", () => {
  const active = new Set<string>(["builtin"]);

  addServiceProfileAllowedDigests(active, [
    {
      disabled: false,
      appliedContracts: [
        { allowedDigests: ["digest-a", "digest-b"] },
        { allowedDigests: ["digest-b", "digest-c"] },
      ],
    },
    { disabled: false, appliedContracts: [{ allowedDigests: ["digest-d"] }] },
    { disabled: true, appliedContracts: [{ allowedDigests: ["digest-e"] }] },
  ]);

  assertEquals([...active].sort(), [
    "builtin",
    "digest-a",
    "digest-b",
    "digest-c",
    "digest-d",
  ]);
});
