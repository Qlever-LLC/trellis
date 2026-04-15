import { assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/result";
import { Type } from "typebox";

import * as authSdk from "../sdk/auth.ts";
import type { TrellisCatalogHandler } from "../sdk/core.ts";
import {
  defineAppContract,
  defineCliContract,
  defineContract,
  defineDeviceContract,
  definePortalContract,
  defineServiceContract,
} from "../contracts.ts";
import * as coreSdk from "../sdk/core.ts";
import * as stateSdk from "../sdk/state.ts";
import * as serverHealth from "../server/health.ts";
import { TrellisService as DenoTrellisService } from "../server/deno.ts";
import { TrellisService as NodeTrellisService } from "../server/node.ts";
import { TrellisServer } from "../server/mod.ts";

Deno.test("server and sdk subpaths expose the canonical wrapper API", () => {
  assertEquals(typeof TrellisServer, "function");
  assertEquals(typeof DenoTrellisService, "function");
  assertEquals(typeof NodeTrellisService, "function");
  assertEquals(typeof serverHealth.HealthRpcSchema, "object");
  assertEquals(typeof serverHealth.runAllHealthChecks, "function");
  assertEquals(typeof authSdk.useDefaults, "function");
  assertEquals(typeof coreSdk.use, "function");
  assertEquals(typeof stateSdk.use, "function");
  assertEquals(typeof authSdk.auth?.useDefaults, "function");
  assertEquals(typeof coreSdk.core?.use, "function");
  assertEquals(typeof stateSdk.state?.use, "function");
  assertEquals(authSdk.auth?.useDefaults, authSdk.useDefaults);
  assertEquals(coreSdk.core?.use, coreSdk.use);
  assertEquals(stateSdk.state?.use, stateSdk.use);
});

Deno.test("contracts subpath defineContract retains contract API projections", () => {
  assertEquals(typeof defineContract, "function");
  assertEquals(typeof defineAppContract, "function");
  assertEquals(typeof definePortalContract, "function");
  assertEquals(typeof defineCliContract, "function");
  assertEquals(typeof defineDeviceContract, "function");
  assertEquals(typeof defineServiceContract, "function");

  const contract = defineServiceContract(
    {
      schemas: {
        Ping: Type.Object({ ok: Type.Literal(true) }),
      },
    },
    (ref) => ({
      id: "example.device@v1",
      displayName: "Example Device",
      description: "Example device contract.",
      rpc: {
        "Example.Ping": {
          version: "v1",
          input: ref.schema("Ping"),
          output: ref.schema("Ping"),
        },
      },
    }),
  );

  assertEquals(typeof contract.CONTRACT_ID, "string");
  assertEquals(typeof contract.API.trellis.rpc["Example.Ping"].subject, "string");
});

Deno.test("generated SDK exports handler aliases for extracted handlers", () => {
  const handler: TrellisCatalogHandler = (payload, context) => {
    const sessionKey: string = context.sessionKey;
    assertEquals(Object.keys(payload).length, 0);
    assertEquals(typeof sessionKey, "string");
    return Result.ok({
      catalog: {
        format: "trellis.catalog.v1",
        contracts: [],
      },
    });
  };

  assertEquals(typeof handler, "function");
});
