import { assertEquals } from "@std/assert";
import {
  defineAppContract,
  defineServiceContract,
  Result,
} from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";
import {
  caseScopedContractId,
  caseScopedName,
  caseScopedSubject,
  integrationSlug,
  runtimeScopeForCase,
  trellisIntegrationTest,
} from "@qlever-llc/trellis-test/integration";
import { externalServiceRepoRuntime } from "../trellis.integration.ts";

const CASE_ID = "external.rpc-smoke" as const;
const slug = integrationSlug(CASE_ID);
const message = `hello-${slug}`;

const schemas = {
  PingInput: Type.Object({ message: Type.String() }),
  PingOutput: Type.Object({ message: Type.String(), reply: Type.String() }),
} as const;

const serviceContract = defineServiceContract({ schemas }, (ref) => ({
  id: caseScopedContractId("external.fixture.rpc-service", CASE_ID),
  displayName: `External Fixture RPC Service (${slug})`,
  description:
    "Out-of-tree style service contract used by trellis-test smoke coverage.",
  capabilities: {
    ping: {
      displayName: "Ping service",
      description: "Call the fixture service ping RPC.",
    },
  },
  rpc: {
    "Echo.Ping": {
      version: "v1",
      subject: caseScopedSubject(
        "rpc.v1.external.fixture",
        CASE_ID,
        "Echo.Ping",
      ),
      input: ref.schema("PingInput"),
      output: ref.schema("PingOutput"),
      capabilities: { call: ["ping"] },
      errors: [],
    },
  },
}));

const clientContract = defineAppContract(() => ({
  id: caseScopedContractId("external.fixture.rpc-client", CASE_ID),
  displayName: `External Fixture RPC Client (${slug})`,
  description:
    "Out-of-tree style app contract used by trellis-test smoke coverage.",
  uses: {
    required: {
      service: serviceContract.use({ rpc: { call: ["Echo.Ping"] } }),
    },
  },
}));

const serviceName = caseScopedName("external-rpc-service", CASE_ID);
const clientName = caseScopedName("external-rpc-client", CASE_ID);

trellisIntegrationTest({
  name: "external.rpc-smoke calls service RPC through generic runner",
  scope: runtimeScopeForCase(CASE_ID),
  runtime: externalServiceRepoRuntime,
  async fn(runtime) {
    await runtime.deployments.create({ mutableDev: true });
    await runtime.contracts.approve({
      contract: serviceContract,
      allowPlanClassifications: ["update"],
    });
    const serviceKey = await runtime.services.provisionInstanceOnly({});
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: serviceContract,
      name: serviceName,
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: {},
    }).orThrow();

    try {
      await service.handle.rpc.echo.ping(({ input }) =>
        Result.ok({ message: input.message, reply: `pong:${input.message}` })
      );

      const client = await runtime.connectClient({
        name: clientName,
        contract: clientContract,
      });
      const result = await client.rpc.echo.ping({ message }).orThrow();

      assertEquals(result, { message, reply: `pong:${message}` });
    } finally {
      await service.stop();
    }
  },
});
