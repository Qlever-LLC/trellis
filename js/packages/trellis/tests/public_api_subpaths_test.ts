import { assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/result";
import { Type } from "typebox";

import { defineServiceContract } from "@qlever-llc/trellis";
import * as authSdk from "@qlever-llc/trellis/sdk/auth";
import * as authSurface from "@qlever-llc/trellis/auth";
import * as authBrowserSurface from "@qlever-llc/trellis/auth/browser";
import type { TrellisCatalogHandler } from "@qlever-llc/trellis/sdk/core";
import * as healthSdk from "@qlever-llc/trellis/sdk/health";
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
// @ts-expect-error Raw NATS handles must not be public service fields.
type ServiceNatsField = TrellisServiceType["nc"];

Deno.test("service, health, and SDK subpaths expose the canonical wrapper API", () => {
  assertEquals("TrellisServer" in serviceSurface, false);
  assertEquals(typeof serviceSurface.TrellisService, "function");
  assertEquals(typeof serviceSurface.OutboxDispatcher, "function");
  assertEquals(typeof DenoTrellisService, "function");
  assertEquals(typeof NodeTrellisService, "function");
  assertEquals("connectInternal" in DenoTrellisService, false);
  assertEquals("connectInternal" in NodeTrellisService, false);
  assertEquals(typeof healthSurface.HealthRpcSchema, "object");
  assertEquals(typeof healthSurface.runAllHealthChecks, "function");
  assertEquals(typeof authSdk.sdk?.use, "function");
  assertEquals(typeof coreSdk.use, "function");
  assertEquals(typeof healthSdk.use, "function");
  assertEquals(typeof stateSdk.use, "function");
  assertEquals(coreSdk.sdk?.use, coreSdk.use);
  assertEquals(healthSdk.sdk?.use, healthSdk.use);
  assertEquals(stateSdk.sdk?.use, stateSdk.use);
});

Deno.test("auth and device runtime subpaths retain depended-on helpers", () => {
  assertEquals(typeof authSurface.startAuthRequest, "function");
  assertEquals(typeof authBrowserSurface.completeSessionLogout, "function");
  assertEquals(typeof authBrowserSurface.fetchPortalFlowState, "function");
  assertEquals(typeof deviceDeno.checkDeviceActivation, "function");
  assertEquals("openDeviceActivationStateStore" in deviceDeno, false);
  assertEquals("resolveDeviceActivationStatePath" in deviceDeno, false);
});

Deno.test("contracts subpath exposes only kind-specific contract helpers", () => {
  assertEquals("defineContract" in contracts, false);
  assertEquals(typeof contracts.defineAppContract, "function");
  assertEquals(typeof contracts.defineAgentContract, "function");
  assertEquals(typeof contracts.defineDeviceContract, "function");
  assertEquals(typeof contracts.defineServiceContract, "function");
  assertEquals(typeof contracts.CursorQuerySchema, "object");
  assertEquals(typeof contracts.CursorPageSchema, "function");
  assertEquals(typeof contracts.normalizeCursorQuery, "function");
  assertEquals(typeof contracts.normalizePageQuery, "function");

  const contract = contracts.defineServiceContract(
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
          errors: [],
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

Deno.test("generated handler aliases support direct handler registration", () => {
  const prefix = "dep";
  const handler: TrellisCatalogHandler = ({ input, context }) => {
    const sessionKey: string = context.sessionKey;
    assertEquals(Object.keys(input).length, 0);
    assertEquals(typeof sessionKey, "string");
    assertEquals(typeof prefix, "string");
    return Result.ok({
      catalog: {
        format: "trellis.catalog.v1",
        contracts: [],
      },
    });
  };

  const register = (service: {
    readonly handle: {
      readonly rpc: {
        readonly trellis: {
          readonly catalog: (handler: TrellisCatalogHandler) => void;
        };
      };
    };
  }) => {
    return service.handle.rpc.trellis.catalog(handler);
  };

  assertEquals(typeof handler, "function");
  assertEquals(typeof register, "function");
});
