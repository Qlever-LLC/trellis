import { assertEquals } from "@std/assert";

import * as authSdk from "../sdk/auth.ts";
import * as coreSdk from "../sdk/core.ts";
import { connectService as connectDenoService } from "../server/deno.ts";
import { connectService as connectNodeService } from "../server/node.ts";
import { TrellisServer } from "../server/mod.ts";

Deno.test("server and sdk subpaths expose the canonical wrapper API", () => {
  assertEquals(typeof TrellisServer, "function");
  assertEquals(typeof connectDenoService, "function");
  assertEquals(typeof connectNodeService, "function");
  assertEquals(typeof authSdk.useDefaults, "function");
  assertEquals(typeof coreSdk.use, "function");
  assertEquals(typeof authSdk.auth?.useDefaults, "function");
  assertEquals(typeof coreSdk.core?.use, "function");
  assertEquals(authSdk.auth?.useDefaults, authSdk.useDefaults);
  assertEquals(coreSdk.core?.use, coreSdk.use);
});
