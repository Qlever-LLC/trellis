import { assertEquals } from "@std/assert";
import { Type } from "typebox";

import * as authSdk from "../sdk/auth.ts";
import { defineContract } from "../contracts.ts";
import * as coreSdk from "../sdk/core.ts";
import * as serverHealth from "../server/health.ts";
import { connectService as connectDenoService } from "../server/deno.ts";
import { connectService as connectNodeService } from "../server/node.ts";
import { TrellisServer } from "../server/mod.ts";

Deno.test("server and sdk subpaths expose the canonical wrapper API", () => {
  assertEquals(typeof TrellisServer, "function");
  assertEquals(typeof connectDenoService, "function");
  assertEquals(typeof connectNodeService, "function");
  assertEquals(typeof serverHealth.HealthRpcSchema, "object");
  assertEquals(typeof serverHealth.runAllHealthChecks, "function");
  assertEquals(typeof authSdk.useDefaults, "function");
  assertEquals(typeof coreSdk.use, "function");
  assertEquals(typeof authSdk.auth?.useDefaults, "function");
  assertEquals(typeof coreSdk.core?.use, "function");
  assertEquals(authSdk.auth?.useDefaults, authSdk.useDefaults);
  assertEquals(coreSdk.core?.use, coreSdk.use);
});

Deno.test("contracts subpath defineContract retains runtime helpers", () => {
  const contract = defineContract({
    id: "example.workload@v1",
    displayName: "Example Workload",
    description: "Example workload contract.",
    kind: "workload",
    schemas: {
      Ping: Type.Object({ ok: Type.Literal(true) }),
    },
    rpc: {
      "Example.Ping": {
        version: "v1",
        input: { schema: "Ping" },
        output: { schema: "Ping" },
      },
    },
  });

  assertEquals(typeof contract.createClient, "function");
});
