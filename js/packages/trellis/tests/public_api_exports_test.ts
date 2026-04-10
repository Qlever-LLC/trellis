import { assert, assertEquals } from "@std/assert";
import { Type } from "typebox";

import {
  buildLoginUrl,
  createClient,
  createCoreClient,
  defineContract,
  err,
  fetchPortalFlowState,
  isErr,
  isOk,
  ok,
  portalFlowIdFromUrl,
  portalProviderLoginUrl,
  portalRedirectLocation,
  Result,
  schema,
  submitPortalApproval,
  TrellisWorkload,
} from "../index.ts";
import * as trellis from "../index.ts";

Deno.test("root public API includes core runtime, contracts, result, and common auth helpers", () => {
  assertEquals(typeof createClient, "function");
  assertEquals(typeof createCoreClient, "function");
  assertEquals(typeof defineContract, "function");
  assertEquals(typeof schema, "function");
  assertEquals(typeof buildLoginUrl, "function");
  assertEquals(typeof portalFlowIdFromUrl, "function");
  assertEquals(typeof fetchPortalFlowState, "function");
  assertEquals(typeof portalProviderLoginUrl, "function");
  assertEquals(typeof submitPortalApproval, "function");
  assertEquals(typeof portalRedirectLocation, "function");
  assertEquals(typeof TrellisWorkload.connect, "function");
  assertEquals(typeof ok, "function");
  assertEquals(typeof err, "function");
  assertEquals(typeof isOk, "function");
  assertEquals(typeof isErr, "function");
  assert(Result);
  assert("schema" in schema<{ ok: true }>(Type.Object({ ok: Type.Literal(true) })));

  const contract = defineContract({
    id: "example.app@v1",
    displayName: "Example App",
    description: "Example app contract.",
    kind: "app",
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

  assertEquals(contract.CONTRACT_ID, "example.app@v1");
});

Deno.test("root public API stays browser-safe and excludes server runtime exports", () => {
  assert(!("TrellisServer" in trellis));
});
