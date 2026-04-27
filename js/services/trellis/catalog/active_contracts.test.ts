import { assertEquals } from "@std/assert";

import { addCurrentContractDigests } from "./active_contracts.ts";

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
