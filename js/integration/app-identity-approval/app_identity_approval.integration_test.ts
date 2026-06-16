import { assertEquals } from "@std/assert";
import {
  defineAppContract,
  defineServiceContract,
  Result,
  TrellisClient,
} from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";
import { withTrellisRuntime } from "../_support/runtime.ts";

const appIdentitySchemas = {
  GrantPingInput: Type.Object({ message: Type.String() }),
  GrantPingOutput: Type.Object({
    message: Type.String(),
    approved: Type.Boolean(),
  }),
} as const;

const appIdentityServiceContract = defineServiceContract(
  { schemas: appIdentitySchemas },
  (ref) => ({
    id: "trellis.integration.app-identity-approval-service@v1",
    displayName: "Trellis Integration App Identity Approval Service",
    description: "Exercises an approved app identity grant with a service RPC.",
    capabilities: {
      approvedPing: {
        displayName: "Call approved ping",
        description: "Call the RPC used by the app identity approval fixture.",
      },
    },
    rpc: {
      "Grant.Ping": {
        version: "v1",
        subject: "rpc.v1.Grant.Ping",
        input: ref.schema("GrantPingInput"),
        output: ref.schema("GrantPingOutput"),
        capabilities: { call: ["approvedPing"] },
        errors: [],
      },
    },
  }),
);

const appIdentityClientContract = defineAppContract(() => ({
  id: "trellis.integration.app-identity-approval-client@v1",
  displayName: "Trellis Integration App Identity Approval Client",
  description: "App/client participant for the app identity approval fixture.",
  uses: {
    required: {
      grantService: appIdentityServiceContract.use({
        rpc: { call: ["Grant.Ping"] },
      }),
    },
  },
}));

Deno.test("app-identity-approval.client-obtains-approved-grant connects after approval", async () => {
  await withTrellisRuntime(async (runtime) => {
    const serviceKey = await runtime.registerService({
      name: "app-identity-approval-fixture-service",
      contract: appIdentityServiceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: appIdentityServiceContract,
      name: "app-identity-approval-fixture-service",
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();

    try {
      await service.handle.rpc.grant.ping(({ input }) =>
        Result.ok({ message: input.message, approved: true })
      );

      const clientKey = await runtime.registerClient({
        name: "app-identity-approval-fixture-client",
        contract: appIdentityClientContract,
      });
      const clientAuth = runtime.clientAuth(clientKey);
      let observedAuth:
        | {
          loginUrl: string;
          sessionKey: string;
          mode: "browser" | "session_key";
        }
        | undefined;
      const client = await TrellisClient.connect({
        trellisUrl: runtime.trellisUrl,
        name: "app-identity-approval-fixture-client",
        contract: appIdentityClientContract,
        auth: clientAuth.auth,
        onAuthRequired: async (ctx) => {
          observedAuth = ctx;
          return await clientAuth.onAuthRequired(ctx);
        },
      }).orThrow();

      try {
        if (observedAuth === undefined) {
          throw new Error("expected app identity approval to require auth");
        }
        const loginUrl = new URL(observedAuth.loginUrl);
        const runtimeUrl = new URL(runtime.trellisUrl);
        assertEquals(loginUrl.protocol, runtimeUrl.protocol);
        assertEquals(loginUrl.port, runtimeUrl.port);
        assertEquals(
          ["127.0.0.1", "localhost"].includes(loginUrl.hostname),
          true,
        );
        assertEquals(loginUrl.searchParams.has("flowId"), true);
        assertEquals(observedAuth.mode, "session_key");
        assertEquals(observedAuth.sessionKey, clientKey.sessionKey);

        const result = await client.rpc.grant.ping({
          message: "app-approved",
        }).orThrow();
        assertEquals(result, { message: "app-approved", approved: true });
      } finally {
        await client.connection.close();
      }
    } finally {
      await service.stop();
    }
  });
});
