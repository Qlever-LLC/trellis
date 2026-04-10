import { assertEquals } from "@std/assert";

import { canonicalizeJson, type JsonValue } from "@qlever-llc/trellis/contracts";

import { CONTRACT } from "./contracts/trellis_activity.ts";

Deno.test("trellis.activity authored source matches emitted contract", async () => {
  const emitted = await Deno.readTextFile(
    new URL("../../../generated/contracts/manifests/trellis.activity@v1.json", import.meta.url),
  );
  assertEquals(emitted.trim(), canonicalizeJson(CONTRACT as JsonValue));
});
