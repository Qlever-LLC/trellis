import {
  defineAgentContract,
  defineServiceContract,
  TrellisClient,
} from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { Type } from "typebox";

const schemas = {
  ResourceExerciseInput: Type.Object({
    key: Type.String(),
    message: Type.String(),
  }),
  ResourceExerciseOutput: Type.Object({
    provider: Type.String(),
    storeText: Type.String(),
    kvMessage: Type.String(),
  }),
  ResourceRecord: Type.Object({ message: Type.String() }),
} as const;

const harness = defineServiceContract({ schemas }, (ref) => ({
  id: "trellis.integration-harness.resources@v1",
  displayName: "Trellis Integration Harness Resources",
  description:
    "Harness-owned service contract for service-bound resource lifecycle verification.",
  uses: {
    required: { auth: auth.use({ rpc: { call: ["Auth.Requests.Validate"] } }) },
  },
  resources: {
    kv: {
      records: {
        purpose: "Store harness resource lifecycle records",
        schema: ref.schema("ResourceRecord"),
        required: true,
        history: 1,
        ttlMs: 0,
      },
      optionalRecords: {
        purpose: "Store optional harness resource lifecycle records",
        schema: ref.schema("ResourceRecord"),
        required: false,
        history: 1,
        ttlMs: 0,
      },
    },
    store: {
      blobs: {
        purpose: "Store harness resource lifecycle blobs",
        required: true,
        ttlMs: 0,
        maxObjectBytes: 1048576,
        maxTotalBytes: 4194304,
      },
      optionalBlobs: {
        purpose: "Store optional harness resource lifecycle blobs",
        required: false,
        ttlMs: 0,
        maxObjectBytes: 1048576,
        maxTotalBytes: 4194304,
      },
    },
  },
  rpc: {
    "Harness.Rust.Resources": {
      version: "v1",
      subject: "rpc.v1.Harness.Rust.Resources",
      input: ref.schema("ResourceExerciseInput"),
      output: ref.schema("ResourceExerciseOutput"),
      capabilities: { call: [] },
      errors: [ref.error("UnexpectedError")],
    },
    "Harness.Ts.Resources": {
      version: "v1",
      subject: "rpc.v1.Harness.Ts.Resources",
      input: ref.schema("ResourceExerciseInput"),
      output: ref.schema("ResourceExerciseOutput"),
      capabilities: { call: [] },
      errors: [ref.error("UnexpectedError")],
    },
  },
}));

const contract = defineAgentContract(() => ({
  id: "trellis.integration-resources-agent@v1",
  displayName: "Trellis Integration Resources Agent",
  description: "Verify delegated Rust agent login and harness resource calls.",
  uses: {
    required: {
      auth: auth.use({
        rpc: { call: ["Auth.Sessions.Logout", "Auth.Sessions.Me"] },
      }),
      harness: harness.use({
        rpc: { call: ["Harness.Rust.Resources", "Harness.Ts.Resources"] },
      }),
    },
  },
}));

const expectedDigest = Deno.env.get("HARNESS_CALLER_CONTRACT_DIGEST");
if (contract.CONTRACT_DIGEST !== expectedDigest) {
  throw new Error(
    `caller contract digest mismatch: ${contract.CONTRACT_DIGEST} !== ${expectedDigest}`,
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

async function assertResourceRpc(
  method: "Harness.Rust.Resources" | "Harness.Ts.Resources",
  provider: "rust" | "ts",
  key: string,
  message: string,
) {
  const output = await client.request(method, { key, message }).orThrow();
  if (output.provider !== provider) {
    throw new Error(`${method} provider mismatch: ${JSON.stringify(output)}`);
  }
  if (output.storeText !== `${provider}-store:${message}`) {
    throw new Error(`${method} store mismatch: ${JSON.stringify(output)}`);
  }
  if (output.kvMessage !== `${provider}-kv:${message}`) {
    throw new Error(`${method} kv mismatch: ${JSON.stringify(output)}`);
  }
}

await assertResourceRpc(
  "Harness.Rust.Resources",
  "rust",
  "ts-client.rust-provider",
  "ts to rust resources",
);
await assertResourceRpc(
  "Harness.Ts.Resources",
  "ts",
  "ts-client.ts-provider",
  "ts to ts resources",
);
await client.natsConnection.drain();
console.log("TS_RESOURCES_CLIENT_OK");
