import {
  defineAgentContract,
  defineError,
  defineServiceContract,
  TrellisClient,
} from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { Type } from "typebox";

const schemas = {
  PingRequest: Type.Object({ message: Type.String() }),
  PingResponse: Type.Object({ message: Type.String() }),
} as const;

const NotFoundError = defineError({
  type: "NotFoundError",
  fields: { resource: Type.String() },
  message: ({ resource }) => `${resource} not found`,
});

const harness = defineServiceContract(
  { schemas, errors: { NotFoundError } },
  (ref) => ({
    id: "trellis.integration-harness.rpc@v1",
    displayName: "Trellis Integration Harness RPC",
    description:
      "Harness-owned service contract for full-stack Rust/TypeScript RPC verification.",
    uses: {
      required: {
        auth: auth.use({ rpc: { call: ["Auth.Requests.Validate"] } }),
      },
    },
    rpc: {
      "Harness.Rust.Ping": {
        version: "v1",
        subject: "rpc.v1.Harness.Rust.Ping",
        input: ref.schema("PingRequest"),
        output: ref.schema("PingResponse"),
        capabilities: { call: [] },
        errors: [ref.error("NotFoundError"), ref.error("UnexpectedError")],
      },
      "Harness.Ts.Ping": {
        version: "v1",
        subject: "rpc.v1.Harness.Ts.Ping",
        input: ref.schema("PingRequest"),
        output: ref.schema("PingResponse"),
        capabilities: { call: [] },
        errors: [ref.error("NotFoundError"), ref.error("UnexpectedError")],
      },
    },
  }),
);

const contract = defineAgentContract(() => ({
  id: "trellis.integration-rpc-agent@v1",
  displayName: "Trellis Integration Agent",
  description: "Verify delegated Rust agent login and harness RPC calls.",
  uses: {
    required: {
      auth: auth.use({
        rpc: { call: ["Auth.Sessions.Logout", "Auth.Sessions.Me"] },
      }),
      harness: harness.use({ rpc: { call: ["Harness.Rust.Ping"] } }),
    },
  },
}));

const expectedDigest = Deno.env.get("HARNESS_CALLER_CONTRACT_DIGEST");
if (contract.CONTRACT_DIGEST !== expectedDigest) {
  throw new Error(
    `updated caller contract digest mismatch: ${contract.CONTRACT_DIGEST} !== ${expectedDigest}`,
  );
}

const client = await TrellisClient.connect({
  trellisUrl: Deno.env.get("TRELLIS_URL")!,
  contract,
  auth: {
    mode: "session_key",
    sessionKeySeed: Deno.env.get("HARNESS_CALLER_SESSION_SEED")!,
    redirectTo: "/_trellis/portal/users/login",
  },
  log: undefined,
}).orThrow();

const response = await client.rpc.harness.rustPing({
  message: "ts-updated-contract",
}).orThrow();
if (response.message !== "ts-updated-contract") {
  throw new Error(`Harness.Rust.Ping returned ${JSON.stringify(response)}`);
}

await client.connection.close();
console.log("TS_UPDATED_CLIENT_OK");
