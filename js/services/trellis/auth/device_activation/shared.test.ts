import { assert, assertFalse } from "@std/assert";

import { isDeviceProofIatFresh } from "./shared.ts";

Deno.test("isDeviceProofIatFresh enforces the documented 30 second skew", () => {
  assert(isDeviceProofIatFresh(100, 100));
  assert(isDeviceProofIatFresh(70, 100));
  assert(isDeviceProofIatFresh(130, 100));
  assertFalse(isDeviceProofIatFresh(69, 100));
  assertFalse(isDeviceProofIatFresh(131, 100));
});
