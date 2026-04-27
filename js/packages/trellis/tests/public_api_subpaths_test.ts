import { assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/result";
import { Type } from "typebox";

import * as authSdk from "@qlever-llc/trellis/sdk/auth";
import type { TrellisCatalogHandler } from "@qlever-llc/trellis/sdk/core";
import * as healthSdk from "@qlever-llc/trellis/sdk/health";
import {
  defineAgentContract,
  defineAppContract,
  defineDeviceContract,
  defineServiceContract,
} from "@qlever-llc/trellis/contracts";
import * as contracts from "@qlever-llc/trellis/contracts";
import * as coreSdk from "@qlever-llc/trellis/sdk/core";
import * as stateSdk from "@qlever-llc/trellis/sdk/state";
import * as healthSurface from "@qlever-llc/trellis/health";
import * as deviceDeno from "@qlever-llc/trellis/device/deno";
import * as serviceSurface from "@qlever-llc/trellis/service";
import type { TrellisService as TrellisServiceType } from "@qlever-llc/trellis/service";
import { TrellisService as DenoTrellisService } from "@qlever-llc/trellis/service/deno";
import { TrellisService as NodeTrellisService } from "@qlever-llc/trellis/service/node";

// @ts-expect-error Service runtime internals must not be public fields.
type ServiceServerField = TrellisServiceType["server"];
// @ts-expect-error Service runtime internals must not be public fields.
type ServiceOperationsField = TrellisServiceType["operations"];

Deno.test("service, health, and SDK subpaths expose the canonical wrapper API", () => {
  assertEquals("TrellisServer" in serviceSurface, false);
  assertEquals(typeof serviceSurface.TrellisService, "function");
  assertEquals(typeof DenoTrellisService, "function");
  assertEquals(typeof NodeTrellisService, "function");
  assertEquals("connectInternal" in DenoTrellisService, false);
  assertEquals("connectInternal" in NodeTrellisService, false);
  assertEquals(typeof deviceDeno.checkDeviceActivation, "function");
  assertEquals("openDeviceActivationStateStore" in deviceDeno, false);
  assertEquals("resolveDeviceActivationStatePath" in deviceDeno, false);
  assertEquals(typeof healthSurface.HealthRpcSchema, "object");
  assertEquals(typeof healthSurface.runAllHealthChecks, "function");
  assertEquals(typeof authSdk.useDefaults, "function");
  assertEquals(typeof coreSdk.use, "function");
  assertEquals(typeof healthSdk.use, "function");
  assertEquals(typeof healthSdk.useDefaults, "function");
  assertEquals(typeof stateSdk.use, "function");
  assertEquals(typeof stateSdk.useDefaults, "function");
  assertEquals(typeof authSdk.auth?.useDefaults, "function");
  assertEquals(typeof coreSdk.core?.use, "function");
  assertEquals(typeof healthSdk.health?.use, "function");
  assertEquals(typeof healthSdk.health?.useDefaults, "function");
  assertEquals(typeof stateSdk.state?.use, "function");
  assertEquals(typeof stateSdk.state?.useDefaults, "function");
  assertEquals(authSdk.auth?.useDefaults, authSdk.useDefaults);
  assertEquals(coreSdk.core?.use, coreSdk.use);
  assertEquals(healthSdk.health?.use, healthSdk.use);
  assertEquals(healthSdk.health?.useDefaults, healthSdk.useDefaults);
  assertEquals(stateSdk.state?.use, stateSdk.use);
  assertEquals(stateSdk.state?.useDefaults, stateSdk.useDefaults);
});

Deno.test("contracts subpath exposes only kind-specific contract helpers", () => {
  assertEquals("defineContract" in contracts, false);
  assertEquals(typeof defineAppContract, "function");
  assertEquals(typeof defineAgentContract, "function");
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
  assertEquals(
    typeof contract.API.trellis.rpc["Example.Ping"].subject,
    "string",
  );
});

Deno.test("generated SDK exports handler aliases for extracted handlers", () => {
  const handler: TrellisCatalogHandler = ({ input, context }) => {
    const sessionKey: string = context.sessionKey;
    assertEquals(Object.keys(input).length, 0);
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
