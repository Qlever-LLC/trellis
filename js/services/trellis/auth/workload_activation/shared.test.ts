import { assert, assertFalse } from "@std/assert";

import { isWorkloadProofIatFresh } from "./shared.ts";

Deno.test("isWorkloadProofIatFresh enforces the documented 30 second skew", () => {
  assert(isWorkloadProofIatFresh(100, 100));
  assert(isWorkloadProofIatFresh(70, 100));
  assert(isWorkloadProofIatFresh(130, 100));
  assertFalse(isWorkloadProofIatFresh(69, 100));
  assertFalse(isWorkloadProofIatFresh(131, 100));
});
