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
import type {
  AuthorityNeedSet,
  DeploymentAuthority,
  ImplementationOffer,
} from "../schemas.ts";
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

const FITTING_SERVICE_NEEDS: AuthorityNeedSet = {
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
};

const FITTING_SERVICE_AUTHORITY: DeploymentAuthority = {
  deploymentId: "worker.default",
  kind: "service",
  disabled: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  version: "2026-01-01T00:00:00.000Z",
  desiredState: {
    needs: [
      ...FITTING_SERVICE_NEEDS.contracts.map((need) => ({
        kind: "contract" as const,
        contractId: need.contractId,
        required: need.required,
      })),
      ...FITTING_SERVICE_NEEDS.surfaces.map(({ required, ...surface }) => ({
        kind: "surface" as const,
        surface,
        required,
      })),
    ],
    capabilities: FITTING_SERVICE_NEEDS.capabilities,
    resources: FITTING_SERVICE_NEEDS.resources,
    surfaces: FITTING_SERVICE_NEEDS.surfaces.map((
      { required: _required, ...surface },
    ) => surface),
  },
};

const EMPTY_SERVICE_AUTHORITY: DeploymentAuthority = {
  ...FITTING_SERVICE_AUTHORITY,
  desiredState: { needs: [], capabilities: [], resources: [], surfaces: [] },
};

function serviceAuthorityWithNeeds(
  needs: AuthorityNeedSet,
): DeploymentAuthority {
  return {
    ...FITTING_SERVICE_AUTHORITY,
    desiredState: {
      needs: [
        ...needs.contracts.map((need) => ({
          kind: "contract" as const,
          contractId: need.contractId,
          required: need.required,
        })),
        ...needs.surfaces.map(({ required, ...surface }) => ({
          kind: "surface" as const,
          surface,
          required,
        })),
      ],
      capabilities: needs.capabilities,
      resources: needs.resources,
      surfaces: needs.surfaces.map(({ required: _required, ...surface }) =>
        surface
      ),
    },
  };
}

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
  runtimeContractDigest?: string;
  authority?: DeploymentAuthority | null;
  contractStorageMiss?: boolean;
  moduleContractKnown?: boolean;
  knownContracts?: Array<{ digest: string; contract: TrellisContractV1 }>;
  activeContracts?: Array<{ digest: string; contract: TrellisContractV1 }>;
  activeOffer?: boolean;
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
  const runtimeContractDigest = args.runtimeContractDigest ?? validated.digest;
  const presentedContractDigest = "presentedContractDigest" in args
    ? args.presentedContractDigest
    : runtimeContractDigest;
  const offers: ImplementationOffer[] = typeof presentedContractDigest ===
        "string" && (args.activeOffer ?? true)
    ? [{
      offerId: JSON.stringify([
        "service",
        "worker.default",
        "worker.1",
        presentedContract.id,
        presentedContractDigest,
      ]),
      deploymentKind: "service",
      deploymentId: "worker.default",
      instanceId: "worker.1",
      contractId: presentedContract.id,
      contractDigest: presentedContractDigest,
      lineageKey: JSON.stringify([
        "service",
        "worker.default",
        presentedContract.id,
      ]),
      status: "accepted",
      liveness: "healthy",
      firstOfferedAt: "2026-01-01T00:00:00.000Z",
      acceptedAt: "2026-01-01T00:00:00.000Z",
      lastRefreshedAt: "2026-01-01T00:00:00.000Z",
      staleAt: null,
      expiresAt: null,
    }]
    : [];
  const digestCheckInput = {
    presentedContractDigest,
    service: {
      instanceId: "worker.1",
      deploymentId: "worker.default",
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
    implementationOfferStorage: {
      listActiveByDigests: (
        digests: Iterable<string>,
        evaluationTime: Date,
      ) => {
        const requested = new Set(digests);
        const now = evaluationTime.toISOString();
        return Promise.resolve(
          offers.filter((offer) =>
            requested.has(offer.contractDigest) &&
            offer.status === "accepted" &&
            offer.acceptedAt !== null &&
            offer.staleAt === null &&
            (offer.expiresAt === null || offer.expiresAt > now)
          ),
        );
      },
      put: (offer: ImplementationOffer) => {
        const index = offers.findIndex((stored) =>
          stored.offerId === offer.offerId
        );
        if (index >= 0) offers[index] = offer;
        else offers.push(offer);
        return Promise.resolve();
      },
    },
    contracts,
    deploymentAuthorityStorage: {
      get: () =>
        Promise.resolve(
          args.authority === undefined
            ? FITTING_SERVICE_AUTHORITY
            : args.authority ?? undefined,
        ),
    },
    now: new Date("2026-01-01T00:00:10.000Z"),
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

Deno.test("auth callout accepts service reconnect when current digest fits deployment authority", async () => {
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

Deno.test("auth callout accepts already accepted matching service offer in strict mode", async () => {
  const contracts = createTestContracts();
  const replacement = await contracts.validateContract(
    incompatibleServiceContract(),
  );
  const result = await serviceDigestCheck({
    presentedContractDigest: replacement.digest,
    presentedContract: replacement.contract,
  });

  assertEquals(result.ok, true);
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

Deno.test("auth callout accepts service reconnect when known dependency metadata fits authority", async () => {
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
    authority: serviceAuthorityWithNeeds({
      contracts: [
        { contractId: SERVICE_CONTRACT.id, required: true },
        { contractId: DEPENDENCY_CONTRACT.id, required: true },
      ],
      surfaces: [
        ...FITTING_SERVICE_NEEDS.surfaces,
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
    }),
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
    authority: serviceAuthorityWithNeeds({
      contracts: [
        { contractId: SERVICE_CONTRACT.id, required: true },
        { contractId: DEPENDENCY_CONTRACT.id, required: true },
        { contractId: SECOND_DEPENDENCY_CONTRACT.id, required: true },
      ],
      surfaces: [
        ...FITTING_SERVICE_NEEDS.surfaces,
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
    }),
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
    authority: serviceAuthorityWithNeeds({
      contracts: [
        { contractId: SERVICE_CONTRACT.id, required: true },
        { contractId: DEPENDENCY_CONTRACT.id, required: true },
      ],
      surfaces: [
        ...FITTING_SERVICE_NEEDS.surfaces,
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
    }),
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
  const dependencyNeeds: AuthorityNeedSet = {
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
  };

  const subjects = getServicePublishSubjectsForContracts(
    ["service", "dependency.read", "dependency.legacy"],
    {
      sessionKey: "service-key",
      contractDigest: service.digest,
      authorityNeeds: dependencyNeeds,
    },
    entries.value,
  );

  assertEquals(subjects.includes("rpc.v1.Dependency.Read"), true);
  assertEquals(subjects.includes("rpc.v1.Dependency.LegacyRead"), false);
});

Deno.test("service runtime permissions include authority-granted optional uses", async () => {
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
  const authorityNeeds: AuthorityNeedSet = {
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
    contractDigest: service.digest,
    authorityNeeds,
  });
  assertEquals(entries.ok, true);
  if (!entries.ok) return;

  const subjects = getServicePublishSubjectsForContracts(
    ["service", "dependency.read"],
    {
      sessionKey: "service-key",
      contractDigest: service.digest,
      authorityNeeds,
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
  const authorityNeeds: AuthorityNeedSet = {
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
    contractDigest: service.digest,
    authorityNeeds,
  });
  assertEquals(entries.ok, true);
  if (!entries.ok) return;

  const serviceDescriptor = {
    sessionKey: "service-key",
    contractDigest: service.digest,
    authorityNeeds,
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
    contractDigest: service.digest,
    authorityNeeds: {
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

Deno.test("callout permission helpers use authority capabilities and deployment bindings", () => {
  assertEquals(
    __testing__.serviceCapabilitiesForPermissions({
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
  const authorityNeeds: AuthorityNeedSet = {
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
    contractDigest: service.digest,
    authorityNeeds,
  });
  assertEquals(entries.ok, true);
  if (!entries.ok) return;

  const subjects = getServicePublishSubjectsForContracts(
    ["service", "dependency.read", "dependency.events"],
    {
      sessionKey: "service-key",
      contractDigest: service.digest,
      authorityNeeds,
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

Deno.test("auth callout rejects service reconnect when global storage misses even if an offer exists", async () => {
  const result = await serviceDigestCheck({
    contractStorageMiss: true,
  });

  assertEquals(result, { ok: false, denial: "contract_changed" });
});

Deno.test("auth callout rejects service reconnect when deployment authority is missing, disabled, or does not fit", async () => {
  assertEquals(
    await serviceDigestCheck({ authority: null }),
    { ok: false, denial: "service_authority_miss" },
  );
  assertEquals(
    await serviceDigestCheck({
      authority: { ...FITTING_SERVICE_AUTHORITY, disabled: true },
    }),
    { ok: false, denial: "service_authority_miss" },
  );
  assertEquals(
    await serviceDigestCheck({ authority: EMPTY_SERVICE_AUTHORITY }),
    { ok: false, denial: "service_authority_miss" },
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
      activeOffer: false,
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
      contractId: "worker.old@v1",
      contractDigest: "digest-old",
      createdAt: new Date("2026-05-08T00:00:00.000Z"),
      lastAuth: new Date("2026-05-08T00:00:00.000Z"),
    },
    service: {
      instanceId: "instance-current",
      deploymentId: "worker.default",
      instanceKey: "service-key",
      disabled: false,
      capabilities: ["service", "worker.run"],
      createdAt: "2026-05-08T00:00:00.000Z",
    },
    contract: {
      contractId: "trellis.worker@v1",
      contractDigest: "digest-current",
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
  assertEquals(session.contractId, "trellis.worker@v1");
  assertEquals(session.contractDigest, "digest-current");
  assertEquals(session.lastAuth, now);
});

Deno.test("service runtime permissions gate optional uses by deployment authority", () => {
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

    const authorityNeeds: AuthorityNeedSet = {
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
    };
    const publishSubjects = getServicePublishSubjects(
      ["service", "auth.me", "billing.refund"],
      {
        sessionKey: "service-key",
        contractDigest: "worker-digest",
        authorityNeeds,
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
