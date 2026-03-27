import { assertEquals } from "@std/assert";

import { trellisApp } from "./trellis_app.ts";

Deno.test("trellis console contract declares jobs read RPC usage", () => {
  assertEquals(trellisApp.CONTRACT.uses?.jobs?.contract, "trellis.jobs@v1");
  assertEquals(trellisApp.CONTRACT.uses?.jobs?.rpc?.call, [
    "Jobs.Get",
    "Jobs.List",
    "Jobs.ListServices",
  ]);
});
