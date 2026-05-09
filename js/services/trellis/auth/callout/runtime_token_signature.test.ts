import { assertEquals } from "@std/assert";
import {
  createAuth,
  createDeviceNatsAuthToken,
} from "@qlever-llc/trellis/auth";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";

import type { ContractRecord } from "../../catalog/schemas.ts";
import { createTestContracts } from "../../catalog/test_contracts.ts";
import {
  getServicePublishSubjectsForContracts,
} from "../../catalog/permissions.ts";
import type { DeploymentEnvelope } from "../schemas.ts";
import { __testing__ } from "./callout.ts";

const TEST_SEED = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TEST_IAT = 1_700_000_000;

const SERVICE_CONTRACT: TrellisContractV1 = {
  format: "trellis.contract.v1",
  id: "trellis.worker@v1",
  displayName: "Worker",
  description: "Worker service",
  kind: "service",
  schemas: { Empty: { type: "object" } },
  rpc: {
    "Worker.Run": {
      version: "v1",
      subject: "rpc.v1.Worker.Run",
      input: { schema: "Empty" },
      output: { schema: "Empty" },
      capabilities: { call: ["worker.run"] },
    },
  },
};

let currentContracts: Array<{ digest: string; contract: TrellisContractV1 }> =
  [];

function setContracts(
  contracts: Array<{ digest: string; contract: TrellisContractV1 }>,
): void {
  currentContracts = contracts;
}

function getContracts(): Array<
  { digest: string; contract: TrellisContractV1 }
> {
  return currentContracts;
}

function getServicePublishSubjects(
  capabilities: string[],
  service: Parameters<typeof getServicePublishSubjectsForContracts>[1],
): string[] {
  return getServicePublishSubjectsForContracts(
    capabilities,
    service,
    currentContracts,
  );
}

const FITTING_SERVICE_ENVELOPE: DeploymentEnvelope = {
  deploymentId: "worker.default",
  kind: "service",
  disabled: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  boundary: {
    contracts: [{ contractId: "trellis.worker@v1", required: true }],
    surfaces: [{
      contractId: "trellis.worker@v1",
      kind: "rpc",
      name: "Worker.Run",
      action: "call",
      required: true,
    }],
    capabilities: [],
    resources: [],
  },
};

const EMPTY_SERVICE_ENVELOPE: DeploymentEnvelope = {
  ...FITTING_SERVICE_ENVELOPE,
  boundary: { contracts: [], surfaces: [], capabilities: [], resources: [] },
};

async function verifiesNatsConnectToken(args: {
  sessionKey: string;
  iat: number;
  contractDigest: string;
  sig: string;
}): Promise<boolean> {
  return await __testing__.verifyRuntimeAuthTokenSignature(args);
}

function makeContractRecord(args: {
  digest: string;
  contract: TrellisContractV1;
}): ContractRecord {
  return {
    digest: args.digest,
    id: args.contract.id,
    displayName: args.contract.displayName,
    description: args.contract.description,
    installedAt: new Date("2026-01-01T00:00:00.000Z"),
    contract: JSON.stringify(args.contract),
    analysisSummary: {
      namespaces: ["trellis"],
      rpcMethods: 1,
      operations: 0,
      operationControls: 0,
      events: 0,
      natsPublish: 0,
      natsSubscribe: 1,
      kvResources: 0,
      storeResources: 0,
      jobsQueues: 0,
    },
    analysis: {
      namespaces: ["trellis"],
      rpc: {
        methods: [{
          key: "Worker.Run",
          subject: "rpc.v1.Worker.Run",
          wildcardSubject: "rpc.v1.Worker.Run",
          callerCapabilities: ["worker.run"],
        }],
      },
      operations: { operations: [], control: [] },
      events: { events: [] },
      nats: {
        publish: [],
        subscribe: [{
          kind: "rpc",
          subject: "rpc.v1.Worker.Run",
          wildcardSubject: "rpc.v1.Worker.Run",
          requiredCapabilities: ["worker.run"],
        }],
      },
      resources: { kv: [], store: [], jobs: [] },
    },
  };
}

async function serviceDigestCheck(args: {
  presentedContractDigest?: string;
  currentContractDigest?: string;
  currentContractId?: string;
  envelope?: DeploymentEnvelope | null;
}) {
  const contracts = createTestContracts();
  const validated = await contracts.validateContract(SERVICE_CONTRACT);
  const currentContractDigest = args.currentContractDigest ?? validated.digest;
  const presentedContractDigest = "presentedContractDigest" in args
    ? args.presentedContractDigest
    : currentContractDigest;
  return await __testing__.validateServiceRuntimeDigest({
    presentedContractDigest,
    service: {
      currentContractId: args.currentContractId ?? "trellis.worker@v1",
      currentContractDigest,
    },
    deployment: {
      deploymentId: "worker.default",
    },
    contractStorage: {
      get: async (digest: string) =>
        digest === validated.digest
          ? makeContractRecord({ digest, contract: SERVICE_CONTRACT })
          : undefined,
    },
    contracts,
    deploymentEnvelopeStorage: {
      get: async () =>
        args.envelope === undefined
          ? FITTING_SERVICE_ENVELOPE
          : args.envelope ?? undefined,
    },
  });
}

for (const principal of ["user", "service"] as const) {
  Deno.test(`auth callout rejects ${principal} token digest tampering via signature`, async () => {
    const auth = await createAuth({ sessionKeySeed: TEST_SEED });
    const sig = await auth.natsConnectSigForIat(TEST_IAT, "digest-a");

    assertEquals(
      await verifiesNatsConnectToken({
        sessionKey: auth.sessionKey,
        iat: TEST_IAT,
        contractDigest: "digest-a",
        sig,
      }),
      true,
    );
    assertEquals(
      await verifiesNatsConnectToken({
        sessionKey: auth.sessionKey,
        iat: TEST_IAT,
        contractDigest: "digest-b",
        sig,
      }),
      false,
    );
  });
}

Deno.test("auth callout rejects device token digest tampering via signature", async () => {
  const auth = await createAuth({ sessionKeySeed: TEST_SEED });
  const token = await createDeviceNatsAuthToken({
    publicIdentityKey: auth.sessionKey,
    identitySeed: TEST_SEED,
    contractDigest: "digest-a",
    iat: TEST_IAT,
  });

  assertEquals(await verifiesNatsConnectToken(token), true);
  assertEquals(
    await verifiesNatsConnectToken({
      ...token,
      contractDigest: "digest-b",
    }),
    false,
  );
});

Deno.test("auth callout accepts service reconnect when current digest fits the deployment envelope", async () => {
  const result = await serviceDigestCheck({});

  assertEquals(result, { ok: true, value: undefined });
});

Deno.test("auth callout rejects service reconnect when deployment envelope is missing, disabled, or does not fit", async () => {
  assertEquals(
    await serviceDigestCheck({ envelope: null }),
    { ok: false, denial: "service_envelope_miss" },
  );
  assertEquals(
    await serviceDigestCheck({
      envelope: { ...FITTING_SERVICE_ENVELOPE, disabled: true },
    }),
    { ok: false, denial: "service_envelope_miss" },
  );
  assertEquals(
    await serviceDigestCheck({ envelope: EMPTY_SERVICE_ENVELOPE }),
    { ok: false, denial: "service_envelope_miss" },
  );
});

Deno.test("auth callout still rejects missing or stale service digests", async () => {
  assertEquals(
    await serviceDigestCheck({ presentedContractDigest: undefined }),
    { ok: false, denial: "invalid_auth_token" },
  );
  assertEquals(
    await serviceDigestCheck({
      presentedContractDigest: "digest-old",
    }),
    { ok: false, denial: "contract_changed" },
  );
  assertEquals(
    await serviceDigestCheck({
      currentContractId: "trellis.other@v1",
    }),
    { ok: false, denial: "contract_changed" },
  );
});

Deno.test("auth callout refreshes existing service session contract metadata", () => {
  const now = new Date("2026-05-09T00:00:00.000Z");
  const session = __testing__.refreshServiceSessionFromInstance({
    session: {
      type: "service",
      trellisId: "service-trellis-id",
      origin: "service",
      id: "service-key",
      email: "worker@trellis.internal",
      name: "Worker",
      instanceId: "instance-old",
      deploymentId: "worker.old",
      instanceKey: "service-key",
      currentContractId: "worker.old@v1",
      currentContractDigest: "digest-old",
      createdAt: new Date("2026-05-08T00:00:00.000Z"),
      lastAuth: new Date("2026-05-08T00:00:00.000Z"),
    },
    service: {
      instanceId: "instance-current",
      deploymentId: "worker.default",
      instanceKey: "service-key",
      disabled: false,
      currentContractId: "trellis.worker@v1",
      currentContractDigest: "digest-current",
      capabilities: ["service", "worker.run"],
      createdAt: "2026-05-08T00:00:00.000Z",
    },
    deployment: {
      deploymentId: "worker.default",
      disabled: false,
      namespaces: ["worker"],
    },
    now,
  });

  assertEquals(session.deploymentId, "worker.default");
  assertEquals(session.instanceId, "instance-current");
  assertEquals(session.currentContractId, "trellis.worker@v1");
  assertEquals(session.currentContractDigest, "digest-current");
  assertEquals(session.lastAuth, now);
});

Deno.test("service runtime permissions gate optional uses by deployment envelope", () => {
  const originalContracts = getContracts();
  const workerContract: TrellisContractV1 = {
    ...SERVICE_CONTRACT,
    uses: {
      required: {
        auth: {
          contract: "trellis.auth@v1",
          rpc: { call: ["Auth.Sessions.Me"] },
        },
      },
      optional: {
        billing: {
          contract: "billing@v1",
          operations: { call: ["Billing.Refund"] },
        },
      },
    },
  };
  try {
    setContracts([
      { digest: "worker-digest", contract: workerContract },
      {
        digest: "auth-digest",
        contract: {
          format: "trellis.contract.v1",
          id: "trellis.auth@v1",
          displayName: "Auth",
          description: "Auth API",
          kind: "service",
          schemas: { Empty: { type: "object" } },
          rpc: {
            "Auth.Sessions.Me": {
              version: "v1",
              subject: "rpc.v1.Auth.Sessions.Me",
              input: { schema: "Empty" },
              output: { schema: "Empty" },
              capabilities: { call: ["auth.me"] },
            },
          },
        },
      },
      {
        digest: "billing-digest",
        contract: {
          format: "trellis.contract.v1",
          id: "billing@v1",
          displayName: "Billing",
          description: "Billing API",
          kind: "service",
          schemas: { Empty: { type: "object" } },
          operations: {
            "Billing.Refund": {
              version: "v1",
              subject: "operations.v1.Billing.Refund",
              input: { schema: "Empty" },
              output: { schema: "Empty" },
              capabilities: { call: ["billing.refund"] },
            },
          },
        },
      },
    ]);

    const publishSubjects = getServicePublishSubjects(
      ["service", "auth.me", "billing.refund"],
      {
        sessionKey: "service-key",
        contractDigest: "worker-digest",
        envelopeBoundary: {
          contracts: [{ contractId: "trellis.auth@v1", required: true }],
          surfaces: [{
            contractId: "trellis.auth@v1",
            kind: "rpc",
            name: "Auth.Sessions.Me",
            action: "call",
            required: true,
          }],
          capabilities: ["auth.me"],
          resources: [],
        },
      },
    );

    assertEquals(publishSubjects.includes("rpc.v1.Auth.Sessions.Me"), true);
    assertEquals(
      publishSubjects.includes("operations.v1.Billing.Refund"),
      false,
    );
  } finally {
    setContracts(originalContracts);
  }
});
