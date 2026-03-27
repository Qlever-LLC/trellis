import { canonicalizeJson, type JsonValue } from "@qlever-llc/trellis-contracts";
import { assertEquals } from "@std/assert";

import { CONTRACT } from "./contracts/trellis_jobs.ts";

Deno.test("trellis.jobs authored source matches emitted contract", async () => {
  const emitted = await Deno.readTextFile(
    new URL("../../../generated/contracts/manifests/trellis.jobs@v1.json", import.meta.url),
  );
  assertEquals(emitted.trim(), canonicalizeJson(CONTRACT as JsonValue));
});
