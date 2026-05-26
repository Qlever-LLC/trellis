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
  getServiceSubscribeSubjectsForContracts,
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

const DEPENDENCY_CONTRACT: TrellisContractV1 = {
  format: "trellis.contract.v1",
  id: "trellis.dependency@v1",
  displayName: "Dependency",
  description: "Dependency service",
  kind: "service",
  schemas: { Empty: { type: "object" } },
  rpc: {
    "Dependency.Read": {
      version: "v1",
      subject: "rpc.v1.Dependency.Read",
      input: { schema: "Empty" },
      output: { schema: "Empty" },
      capabilities: { call: ["dependency.read"] },
    },
  },
};

function dependencyWithEventContract(): TrellisContractV1 {
  return {
    ...DEPENDENCY_CONTRACT,
    schemas: {
      ...DEPENDENCY_CONTRACT.schemas,
      DependencyChangedEvent: { type: "object" },
    },
    events: {
      "Dependency.Changed": {
        version: "v1",
        subject: "events.v1.Dependency.Changed",
        event: { schema: "DependencyChangedEvent" },
        capabilities: { subscribe: ["dependency.events"] },
      },
    },
  };
}

const SECOND_DEPENDENCY_CONTRACT: TrellisContractV1 = {
  format: "trellis.contract.v1",
  id: "trellis.second-dependency@v1",
  displayName: "Second Dependency",
  description: "Second dependency service",
  kind: "service",
  schemas: { Empty: { type: "object" } },
  rpc: {
    "SecondDependency.Read": {
      version: "v1",
      subject: "rpc.v1.SecondDependency.Read",
      input: { schema: "Empty" },
      output: { schema: "Empty" },
      capabilities: { call: ["second-dependency.read"] },
    },
  },
};

function incompatibleServiceContract(): TrellisContractV1 {
  return {
    ...SERVICE_CONTRACT,
    schemas: { Empty: { type: "string" } },
  };
}

function serviceUsingDependencyContract(): TrellisContractV1 {
  return {
    ...SERVICE_CONTRACT,
    uses: {
      required: {
        dependency: {
          contract: DEPENDENCY_CONTRACT.id,
          rpc: { call: ["Dependency.Read"] },
        },
      },
    },
  };
}

function serviceUsingOptionalDependencyContract(): TrellisContractV1 {
  return {
    ...SERVICE_CONTRACT,
    uses: {
      optional: {
        dependency: {
          contract: DEPENDENCY_CONTRACT.id,
          rpc: { call: ["Dependency.Read"] },
        },
      },
    },
  };
}

function serviceUsingOptionalDependencyContractWithEvent(): TrellisContractV1 {
  return {
    ...SERVICE_CONTRACT,
    uses: {
      optional: {
        dependency: {
          contract: DEPENDENCY_CONTRACT.id,
          rpc: { call: ["Dependency.Read"] },
          events: { subscribe: ["Dependency.Changed"] },
        },
      },
    },
  };
}

function serviceSubscribingToDependencyEventContract(): TrellisContractV1 {
  return {
    ...SERVICE_CONTRACT,
    uses: {
      required: {
        dependency: {
          contract: DEPENDENCY_CONTRACT.id,
          events: { subscribe: ["Dependency.Changed"] },
        },
      },
    },
  };
}

function serviceUsingTwoDependencyContracts(): TrellisContractV1 {
  return {
    ...SERVICE_CONTRACT,
    uses: {
      required: {
        dependency: {
          contract: DEPENDENCY_CONTRACT.id,
          rpc: { call: ["Dependency.Read"] },
        },
        secondDependency: {
          contract: SECOND_DEPENDENCY_CONTRACT.id,
          rpc: { call: ["SecondDependency.Read"] },
        },
      },
    },
  };
}

function staleDependencyContract(): TrellisContractV1 {
  return {
    ...DEPENDENCY_CONTRACT,
    schemas: {
      Empty: { type: "object", properties: { stale: { type: "string" } } },
    },
    rpc: {
      "Dependency.Read": {
        version: "v1",
        subject: "rpc.v1.Dependency.LegacyRead",
        input: { schema: "Empty" },
        output: { schema: "Empty" },
        capabilities: { call: ["dependency.legacy"] },
      },
    },
  };
}

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
  presentedContract?: TrellisContractV1;
  currentContractDigest?: string;
  currentContractId?: string;
  envelope?: DeploymentEnvelope | null;
  contractStorageMiss?: boolean;
  moduleContractKnown?: boolean;
  knownContracts?: Array<{ digest: string; contract: TrellisContractV1 }>;
  activeContracts?: Array<{ digest: string; contract: TrellisContractV1 }>;
  deploymentEvidenceExists?: boolean;
  contractCompatibilityMode?: "strict" | "mutable-dev";
}) {
  const contracts = createTestContracts();
  const validated = await contracts.validateContract(SERVICE_CONTRACT);
  if (!args.contractStorageMiss) {
    contracts.addKnownTestContract({
      digest: validated.digest,
      contract: SERVICE_CONTRACT,
    });
  }
  const presentedContract = args.presentedContract ?? SERVICE_CONTRACT;
  const validatedPresented = await contracts.validateContract(
    presentedContract,
  );
  if (args.moduleContractKnown) {
    contracts.addKnownTestContract({
      digest: validatedPresented.digest,
      contract: presentedContract,
    });
  }
  for (const entry of args.knownContracts ?? []) {
    contracts.addKnownTestContract(entry);
  }
  for (const entry of args.activeContracts ?? []) {
    contracts.activateTestContract(entry);
  }
  const currentContractDigest = args.currentContractDigest ?? validated.digest;
  const presentedContractDigest = "presentedContractDigest" in args
    ? args.presentedContractDigest
    : currentContractDigest;
  const digestCheckInput = {
    presentedContractDigest,
    service: {
      currentContractId: args.currentContractId ?? "trellis.worker@v1",
      currentContractDigest,
    },
    deployment: {
      deploymentId: "worker.default",
      contractCompatibilityMode: args.contractCompatibilityMode ?? "strict",
    },
    contractStorage: {
      get: (digest: string) =>
        Promise.resolve(
          !args.contractStorageMiss && digest === validatedPresented.digest
            ? makeContractRecord({ digest, contract: presentedContract })
            : undefined,
        ),
    },
    deploymentContractEvidenceStorage: {
      get: (deploymentId: string, digest: string) =>
        Promise.resolve(
          args.deploymentEvidenceExists && deploymentId === "worker.default" &&
            digest === validated.digest
            ? {
              deploymentId,
              contractId: SERVICE_CONTRACT.id,
              contractDigest: digest,
              contract: SERVICE_CONTRACT,
              firstSeenAt: "2026-01-01T00:00:00.000Z",
              lastSeenAt: "2026-01-01T00:00:00.000Z",
            }
            : undefined,
        ),
    },
    contracts,
    deploymentEnvelopeStorage: {
      get: () =>
        Promise.resolve(
          args.envelope === undefined
            ? FITTING_SERVICE_ENVELOPE
            : args.envelope ?? undefined,
        ),
    },
  };
  return await __testing__.validateServiceRuntimeDigest(digestCheckInput);
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

  assertEquals(result.ok, true);
});

Deno.test("auth callout accepts service reconnect when presented contract id fits despite digest change", async () => {
  const contracts = createTestContracts();
  const updatedContract: TrellisContractV1 = {
    ...SERVICE_CONTRACT,
    capabilities: {
      "worker.run": {
        displayName: "Run worker",
        description: "Call worker RPCs.",
      },
    },
  };
  const validatedUpdated = await contracts.validateContract(updatedContract);
  const result = await serviceDigestCheck({
    presentedContractDigest: validatedUpdated.digest,
    presentedContract: updatedContract,
  });

  assertEquals(result.ok, true);
});

Deno.test("auth callout rejects incompatible same-contract digest replacement in strict mode", async () => {
  const contracts = createTestContracts();
  const replacement = await contracts.validateContract(
    incompatibleServiceContract(),
  );
  const result = await serviceDigestCheck({
    presentedContractDigest: replacement.digest,
    presentedContract: replacement.contract,
  });

  assertEquals(result, { ok: false, denial: "contract_changed" });
});

Deno.test("auth callout accepts incompatible same-contract digest replacement in mutable-dev mode", async () => {
  const contracts = createTestContracts();
  const replacement = await contracts.validateContract(
    incompatibleServiceContract(),
  );
  const result = await serviceDigestCheck({
    presentedContractDigest: replacement.digest,
    presentedContract: replacement.contract,
    contractCompatibilityMode: "mutable-dev",
  });

  assertEquals(result.ok, true);
});

Deno.test("auth callout accepts service reconnect using known contract module fallback", async () => {
  const result = await serviceDigestCheck({
    contractStorageMiss: true,
    moduleContractKnown: true,
  });

  assertEquals(result.ok, true);
});

Deno.test("auth callout accepts service reconnect when known dependency metadata fits envelope", async () => {
  const contracts = createTestContracts();
  const dependency = await contracts.validateContract(DEPENDENCY_CONTRACT);
  const service = await contracts.validateContract(
    serviceUsingDependencyContract(),
  );

  const result = await serviceDigestCheck({
    presentedContractDigest: service.digest,
    presentedContract: service.contract,
    knownContracts: [{
      digest: dependency.digest,
      contract: dependency.contract,
    }],
    envelope: {
      ...FITTING_SERVICE_ENVELOPE,
      boundary: {
        contracts: [
          { contractId: SERVICE_CONTRACT.id, required: true },
          { contractId: DEPENDENCY_CONTRACT.id, required: true },
        ],
        surfaces: [
          ...FITTING_SERVICE_ENVELOPE.boundary.surfaces,
          {
            contractId: DEPENDENCY_CONTRACT.id,
            kind: "rpc",
            name: "Dependency.Read",
            action: "call",
            required: true,
          },
        ],
        capabilities: ["dependency.read"],
        resources: [],
      },
    },
  });

  assertEquals(result.ok, true);
});

Deno.test("auth callout accepts service reconnect when multiple known dependencies resolve together", async () => {
  const contracts = createTestContracts();
  const dependency = await contracts.validateContract(DEPENDENCY_CONTRACT);
  const secondDependency = await contracts.validateContract(
    SECOND_DEPENDENCY_CONTRACT,
  );
  const service = await contracts.validateContract(
    serviceUsingTwoDependencyContracts(),
  );

  const result = await serviceDigestCheck({
    presentedContractDigest: service.digest,
    presentedContract: service.contract,
    knownContracts: [
      {
        digest: dependency.digest,
        contract: dependency.contract,
      },
      {
        digest: secondDependency.digest,
        contract: secondDependency.contract,
      },
    ],
    envelope: {
      ...FITTING_SERVICE_ENVELOPE,
      boundary: {
        contracts: [
          { contractId: SERVICE_CONTRACT.id, required: true },
          { contractId: DEPENDENCY_CONTRACT.id, required: true },
          { contractId: SECOND_DEPENDENCY_CONTRACT.id, required: true },
        ],
        surfaces: [
          ...FITTING_SERVICE_ENVELOPE.boundary.surfaces,
          {
            contractId: DEPENDENCY_CONTRACT.id,
            kind: "rpc",
            name: "Dependency.Read",
            action: "call",
            required: true,
          },
          {
            contractId: SECOND_DEPENDENCY_CONTRACT.id,
            kind: "rpc",
            name: "SecondDependency.Read",
            action: "call",
            required: true,
          },
        ],
        capabilities: ["dependency.read", "second-dependency.read"],
        resources: [],
      },
    },
  });

  assertEquals(result.ok, true);
});

Deno.test("auth callout ignores stale incompatible dependency manifests when active dependency resolves", async () => {
  const contracts = createTestContracts();
  const staleDependency = await contracts.validateContract(
    staleDependencyContract(),
  );
  const dependency = await contracts.validateContract(DEPENDENCY_CONTRACT);
  const service = await contracts.validateContract(
    serviceUsingDependencyContract(),
  );

  const result = await serviceDigestCheck({
    presentedContractDigest: service.digest,
    presentedContract: service.contract,
    knownContracts: [{
      digest: staleDependency.digest,
      contract: staleDependency.contract,
    }],
    activeContracts: [{
      digest: dependency.digest,
      contract: dependency.contract,
    }],
    envelope: {
      ...FITTING_SERVICE_ENVELOPE,
      boundary: {
        contracts: [
          { contractId: SERVICE_CONTRACT.id, required: true },
          { contractId: DEPENDENCY_CONTRACT.id, required: true },
        ],
        surfaces: [
          ...FITTING_SERVICE_ENVELOPE.boundary.surfaces,
          {
            contractId: DEPENDENCY_CONTRACT.id,
            kind: "rpc",
            name: "Dependency.Read",
            action: "call",
            required: true,
          },
        ],
        capabilities: ["dependency.read"],
        resources: [],
      },
    },
  });

  assertEquals(result.ok, true);
});

Deno.test("service runtime permission dependencies ignore stale incompatible known manifests", async () => {
  const contracts = createTestContracts();
  const staleDependency = await contracts.validateContract(
    staleDependencyContract(),
  );
  const dependency = await contracts.validateContract(DEPENDENCY_CONTRACT);
  const service = await contracts.validateContract(
    serviceUsingDependencyContract(),
  );
  contracts.activateTestContract({
    digest: dependency.digest,
    contract: dependency.contract,
  });
  contracts.addKnownTestContract({
    digest: staleDependency.digest,
    contract: staleDependency.contract,
  });

  const entries = await __testing__.withKnownDependencyEntries(contracts, [
    ...(await contracts.getActiveEntries()),
    { digest: service.digest, contract: service.contract },
  ]);
  assertEquals(entries.ok, true);
  if (!entries.ok) return;

  const subjects = getServicePublishSubjectsForContracts(
    ["service", "dependency.read", "dependency.legacy"],
    {
      sessionKey: "service-key",
      contractDigest: service.digest,
      envelopeBoundary: {
        contracts: [{ contractId: DEPENDENCY_CONTRACT.id, required: true }],
        surfaces: [{
          contractId: DEPENDENCY_CONTRACT.id,
          kind: "rpc",
          name: "Dependency.Read",
          action: "call",
          required: true,
        }],
        capabilities: ["dependency.read"],
        resources: [],
      },
    },
    entries.value,
  );

  assertEquals(subjects.includes("rpc.v1.Dependency.Read"), true);
  assertEquals(subjects.includes("rpc.v1.Dependency.LegacyRead"), false);
});

Deno.test("service runtime permissions include envelope-granted optional uses", async () => {
  const contracts = createTestContracts();
  const dependency = await contracts.validateContract(DEPENDENCY_CONTRACT);
  const service = await contracts.validateContract(
    serviceUsingOptionalDependencyContract(),
  );
  contracts.addKnownTestContract({
    digest: service.digest,
    contract: service.contract,
  });
  contracts.addKnownTestContract({
    digest: dependency.digest,
    contract: dependency.contract,
  });
  const envelopeBoundary: DeploymentEnvelope["boundary"] = {
    contracts: [
      { contractId: SERVICE_CONTRACT.id, required: true },
      { contractId: DEPENDENCY_CONTRACT.id, required: false },
    ],
    surfaces: [{
      contractId: DEPENDENCY_CONTRACT.id,
      kind: "rpc",
      name: "Dependency.Read",
      action: "call",
      required: false,
    }],
    capabilities: [],
    resources: [],
  };

  const entries = await __testing__.serviceContractEntriesForPermissions({
    activeContractEntries: [],
    contracts,
    currentContractDigest: service.digest,
    envelopeBoundary,
  });
  assertEquals(entries.ok, true);
  if (!entries.ok) return;

  const subjects = getServicePublishSubjectsForContracts(
    ["service", "dependency.read"],
    {
      sessionKey: "service-key",
      contractDigest: service.digest,
      envelopeBoundary,
    },
    entries.value,
  );

  assertEquals(subjects.includes("rpc.v1.Dependency.Read"), true);
});

Deno.test("service runtime permissions include known inactive required event uses", async () => {
  const contracts = createTestContracts();
  const dependency = await contracts.validateContract(
    dependencyWithEventContract(),
  );
  const service = await contracts.validateContract(
    serviceSubscribingToDependencyEventContract(),
  );
  contracts.addKnownTestContract({
    digest: service.digest,
    contract: service.contract,
  });
  contracts.addKnownTestContract({
    digest: dependency.digest,
    contract: dependency.contract,
  });
  const envelopeBoundary: DeploymentEnvelope["boundary"] = {
    contracts: [
      { contractId: SERVICE_CONTRACT.id, required: true },
      { contractId: DEPENDENCY_CONTRACT.id, required: true },
    ],
    surfaces: [{
      contractId: DEPENDENCY_CONTRACT.id,
      kind: "event",
      name: "Dependency.Changed",
      action: "subscribe",
      required: true,
    }],
    capabilities: ["dependency.events"],
    resources: [],
  };

  const entries = await __testing__.serviceContractEntriesForPermissions({
    activeContractEntries: [],
    contracts,
    currentContractDigest: service.digest,
    envelopeBoundary,
  });
  assertEquals(entries.ok, true);
  if (!entries.ok) return;

  const serviceDescriptor = {
    sessionKey: "service-key",
    contractDigest: service.digest,
    envelopeBoundary,
  };
  const publishSubjects = getServicePublishSubjectsForContracts(
    ["service", "dependency.events"],
    serviceDescriptor,
    entries.value,
  );
  const subscribeSubjects = getServiceSubscribeSubjectsForContracts(
    ["service", "dependency.events"],
    serviceDescriptor,
    entries.value,
  );

  assertEquals(
    subscribeSubjects.includes("events.v1.Dependency.Changed"),
    true,
  );
  assertEquals(publishSubjects.includes("$JS.API.INFO"), true);
  assertEquals(
    publishSubjects.includes("$JS.API.CONSUMER.DURABLE.CREATE.trellis.>"),
    false,
  );
  assertEquals(
    publishSubjects.includes("$JS.API.CONSUMER.INFO.trellis.>"),
    false,
  );
  assertEquals(
    publishSubjects.includes("$JS.API.CONSUMER.MSG.NEXT.trellis.>"),
    false,
  );
  assertEquals(publishSubjects.includes("$JS.ACK.>"), false);
});

Deno.test("service runtime permissions ignore optional uses without granted surfaces", async () => {
  const contracts = createTestContracts();
  const service = await contracts.validateContract(
    serviceUsingOptionalDependencyContract(),
  );
  contracts.addKnownTestContract({
    digest: service.digest,
    contract: service.contract,
  });

  const entries = await __testing__.serviceContractEntriesForPermissions({
    activeContractEntries: [],
    contracts,
    currentContractDigest: service.digest,
    envelopeBoundary: {
      contracts: [
        { contractId: SERVICE_CONTRACT.id, required: true },
        { contractId: DEPENDENCY_CONTRACT.id, required: false },
      ],
      surfaces: [],
      capabilities: [],
      resources: [],
    },
  });

  assertEquals(entries.ok, true);
  if (!entries.ok) return;
  assertEquals(
    entries.value.some((entry) => entry.contract.id === DEPENDENCY_CONTRACT.id),
    false,
  );
});

Deno.test("callout permission helpers use envelope capabilities and deployment bindings", () => {
  assertEquals(
    __testing__.serviceCapabilitiesForPermissions([], {
      contracts: [],
      surfaces: [],
      capabilities: ["dependency.events"],
      resources: [],
    }),
    ["dependency.events", "service"],
  );

  assertEquals(
    __testing__.resourceBindingsForPermissions([{
      kind: "event-consumer",
      alias: "ingest",
      binding: {
        stream: "trellis",
        consumerName: "consumer-1",
        filterSubjects: ["events.v1.Dependency.Changed"],
        replay: "new",
        ordering: "strict",
        concurrency: 1,
        ackWaitMs: 300000,
        maxDeliver: 5,
        backoffMs: [5000],
      },
    }]),
    {
      eventConsumers: {
        ingest: {
          stream: "trellis",
          consumerName: "consumer-1",
          filterSubjects: ["events.v1.Dependency.Changed"],
          replay: "new",
          ordering: "strict",
          concurrency: 1,
          ackWaitMs: 300000,
          maxDeliver: 5,
          backoffMs: [5000],
        },
      },
    },
  );
});

Deno.test("service runtime permissions do not promote ungranted optional event uses", async () => {
  const contracts = createTestContracts();
  const dependency = await contracts.validateContract(
    dependencyWithEventContract(),
  );
  const service = await contracts.validateContract(
    serviceUsingOptionalDependencyContractWithEvent(),
  );
  contracts.addKnownTestContract({
    digest: service.digest,
    contract: service.contract,
  });
  contracts.addKnownTestContract({
    digest: dependency.digest,
    contract: dependency.contract,
  });
  const envelopeBoundary: DeploymentEnvelope["boundary"] = {
    contracts: [
      { contractId: SERVICE_CONTRACT.id, required: true },
      { contractId: DEPENDENCY_CONTRACT.id, required: false },
    ],
    surfaces: [{
      contractId: DEPENDENCY_CONTRACT.id,
      kind: "rpc",
      name: "Dependency.Read",
      action: "call",
      required: false,
    }],
    capabilities: [],
    resources: [],
  };

  const entries = await __testing__.serviceContractEntriesForPermissions({
    activeContractEntries: [],
    contracts,
    currentContractDigest: service.digest,
    envelopeBoundary,
  });
  assertEquals(entries.ok, true);
  if (!entries.ok) return;

  const subjects = getServicePublishSubjectsForContracts(
    ["service", "dependency.read", "dependency.events"],
    {
      sessionKey: "service-key",
      contractDigest: service.digest,
      envelopeBoundary,
    },
    entries.value,
  );

  assertEquals(subjects.includes("rpc.v1.Dependency.Read"), true);
  assertEquals(subjects.includes("$JS.API.CONSUMER.CREATE.trellis"), false);
});

Deno.test("service runtime permission dependency misses deny cleanly", async () => {
  const contracts = createTestContracts();
  const service = await contracts.validateContract(
    serviceUsingDependencyContract(),
  );

  const entries = await __testing__.withKnownDependencyEntries(contracts, [
    { digest: service.digest, contract: service.contract },
  ]);

  assertEquals(entries, { ok: false, denial: "insufficient_permissions" });
});

Deno.test("auth callout rejects service reconnect when global storage misses even if evidence exists", async () => {
  const result = await serviceDigestCheck({
    contractStorageMiss: true,
    deploymentEvidenceExists: true,
  });

  assertEquals(result, { ok: false, denial: "contract_changed" });
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

Deno.test("auth callout still rejects missing or unknown service digests", async () => {
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
