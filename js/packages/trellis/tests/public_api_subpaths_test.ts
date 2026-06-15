import { assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/result";
import { Type } from "typebox";

import { defineServiceContract } from "@qlever-llc/trellis";
import * as authSdk from "@qlever-llc/trellis/sdk/auth";
import * as authSurface from "@qlever-llc/trellis/auth";
import * as authBrowserSurface from "@qlever-llc/trellis/auth/browser";
import type {
  ServiceWithDeps as CoreServiceWithDeps,
  TrellisCatalogHandler,
} from "@qlever-llc/trellis/sdk/core";
import * as healthSdk from "@qlever-llc/trellis/sdk/health";
import * as contracts from "@qlever-llc/trellis/contracts";
import * as coreSdk from "@qlever-llc/trellis/sdk/core";
import * as stateSdk from "@qlever-llc/trellis/sdk/state";
import * as healthSurface from "@qlever-llc/trellis/health";
import * as deviceDeno from "@qlever-llc/trellis/device/deno";
import * as serviceSurface from "@qlever-llc/trellis/service";
import type {
  BoundServiceOf,
  JobArgs,
  JobResult,
  OperationHandler,
  TrellisService as TrellisServiceType,
} from "@qlever-llc/trellis/service";
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

Deno.test("service subpath retains extracted handler helper types", () => {
  const typeSurfaceContract = defineServiceContract(
    {
      schemas: {
        Input: Type.Object({ value: Type.String() }),
        Progress: Type.Object({ value: Type.String() }),
        Output: Type.Object({ ok: Type.Boolean() }),
        JobPayload: Type.Object({ siteId: Type.String() }),
        JobOutput: Type.Object({ refreshId: Type.String() }),
      },
    },
    (ref) => ({
      id: "example.service-types@v1",
      displayName: "Example Service Types",
      description: "Verifies retained service helper type exports.",
      operations: {
        "Example.Run": {
          version: "v1",
          input: ref.schema("Input"),
          progress: ref.schema("Progress"),
          output: ref.schema("Output"),
        },
      },
      jobs: {
        refresh: {
          payload: ref.schema("JobPayload"),
          result: ref.schema("JobOutput"),
        },
      },
    }),
  );

  type Args = JobArgs<typeof typeSurfaceContract, "refresh">;
  type Return = JobResult<typeof typeSurfaceContract, "refresh">;
  type Handler = OperationHandler<typeof typeSurfaceContract, "Example.Run">;
  const argsTypeCheck: Args | undefined = undefined;
  const returnTypeCheck: Return | undefined = undefined;
  const handler: Handler = ({ input }) => {
    const value: string = input.value;
    assertEquals(typeof value, "string");
  };

  assertEquals(argsTypeCheck, undefined);
  assertEquals(returnTypeCheck, undefined);
  assertEquals(typeof handler, "function");
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

  type BoundExampleService = BoundServiceOf<
    typeof contract,
    { readonly prefix: string }
  >;
  const expectBoundService = (service: BoundExampleService) => service.handle;
  assertEquals(typeof expectBoundService, "function");
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

Deno.test("generated handler aliases support bound service registration", () => {
  type Deps = { readonly prefix: string };
  const handler: TrellisCatalogHandler<Deps> = ({ input, context, deps }) => {
    const sessionKey: string = context.sessionKey;
    const prefix: string = deps.prefix;
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

  const register = (service: CoreServiceWithDeps<Deps>) => {
    return service.handle.rpc.trellis.catalog(handler);
  };

  assertEquals(typeof handler, "function");
  assertEquals(typeof register, "function");
});
