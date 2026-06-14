import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { defineServiceContract } from "@qlever-llc/trellis";
import {
  HealthResponseSchema,
  HealthRpcSchema,
} from "@qlever-llc/trellis/health";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { TrellisTestRuntime } from "../index.ts";

const RUN_RUNTIME_PROCESS_TEST =
  Deno.env.get("TRELLIS_TEST_RUNTIME_PROCESS") ===
    "1";
const SERVICE_NAME = "runtime-process";
const trellisMainPath = fromFileUrl(
  new URL("../../../services/trellis/main.ts", import.meta.url),
);

Deno.test("TrellisTestRuntime.start requires explicit trellis command", async () => {
  await assertRejects(
    // @ts-expect-error Runtime validation must reject invalid JavaScript callers.
    () => TrellisTestRuntime.start({}),
    Error,
    "TrellisTestRuntime.start requires trellis.command",
  );
});

const runtimeProcessContract = defineServiceContract(
  {
    schemas: {
      HealthRequest: HealthRpcSchema,
      HealthResponse: HealthResponseSchema,
    },
  },
  (ref) => ({
    id: "trellis.test.runtime-process@v1",
    displayName: "Trellis Test Runtime Process Service",
    description: "Verifies public service bootstrap against a spawned runtime.",
    rpc: {
      "RuntimeProcess.Health": {
        version: "v1",
        input: ref.schema("HealthRequest"),
        output: ref.schema("HealthResponse"),
        errors: [],
      },
    },
  }),
);

Deno.test({
  name:
    "TrellisTestRuntime starts a local Trellis process and connects a service",
  ignore: !RUN_RUNTIME_PROCESS_TEST,
  fn: async () => {
    const runtime = await TrellisTestRuntime.start({
      trellis: {
        command: {
          cmd: Deno.execPath(),
          args: ["run", "-A", trellisMainPath],
        },
      },
      timeouts: {
        startupMs: 60_000,
        reconciliationMs: 15_000,
        shutdownMs: 10_000,
      },
    });

    try {
      assertStringIncludes(runtime.trellisUrl, "http://127.0.0.1:");
      assertStringIncludes(runtime.natsUrl, "127.0.0.1:");

      const serviceKey = await runtime.registerService({
        name: SERVICE_NAME,
        contract: runtimeProcessContract,
      });
      const service = await TrellisService.connect({
        trellisUrl: runtime.trellisUrl,
        contract: runtimeProcessContract,
        name: SERVICE_NAME,
        sessionKeySeed: serviceKey.seed,
        telemetry: false,
        server: {},
      }).orThrow();

      try {
        assertEquals(service.name, SERVICE_NAME);
        assertEquals(service.auth.sessionKey, serviceKey.sessionKey);
      } finally {
        await service.stop();
      }
    } finally {
      await runtime.stop();
    }
  },
});
