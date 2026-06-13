import { assertEquals } from "@std/assert";
import {
  createAuth,
  createDeviceNatsAuthToken,
} from "@qlever-llc/trellis/auth";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";

import type { ContractRecord } from "../../catalog/schemas.ts";
import { createTestContracts } from "../../catalog/test_contracts.ts";
import type {
  AuthorityNeedSet,
  DeploymentAuthority,
  DeploymentAuthorityMaterialization,
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
    needs: FITTING_SERVICE_NEEDS,
    capabilities: FITTING_SERVICE_NEEDS.capabilities.map((need) =>
      need.capability
    ),
    resources: FITTING_SERVICE_NEEDS.resources,
    surfaces: FITTING_SERVICE_NEEDS.surfaces.map((
      { required: _required, ...surface },
    ) => surface),
  },
};

function materializedServiceAuthority(
  overrides: Partial<DeploymentAuthorityMaterialization> = {},
): DeploymentAuthorityMaterialization {
  return {
    deploymentId: "worker.default",
    desiredVersion: FITTING_SERVICE_AUTHORITY.version,
    status: "current",
    resourceBindings: [],
    grants: {
      capabilities: [{ capability: "worker.run" }],
      surfaces: [],
      nats: [{
        direction: "subscribe",
        subject: "rpc.v1.Worker.Run",
        requiredCapabilities: ["worker.run"],
        grantSource: "owned-surface",
      }],
    },
    reconciledAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function serviceAuthorityWithNeeds(
  needs: AuthorityNeedSet,
): DeploymentAuthority {
  return {
    ...FITTING_SERVICE_AUTHORITY,
    desiredState: {
      needs,
      capabilities: needs.capabilities.map((need) => need.capability),
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
  offerStaleAt?: string | null;
  contractCompatibilityMode?: "strict" | "mutable-dev";
  materializedAuthority?: DeploymentAuthorityMaterialization | null;
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
      staleAt: args.offerStaleAt ?? null,
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
            (offer.staleAt === null || offer.staleAt > now) &&
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
    materializedAuthorityStorage: {
      get: () =>
        Promise.resolve(
          args.materializedAuthority === undefined
            ? materializedServiceAuthority({
              desiredVersion: (args.authority ?? FITTING_SERVICE_AUTHORITY)
                .version,
            })
            : args.materializedAuthority ?? undefined,
        ),
      listByDeployment: () => Promise.resolve([]),
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
      capabilities: [{ capability: "dependency.read", required: true }],
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
      capabilities: [
        { capability: "dependency.read", required: true },
        { capability: "second-dependency.read", required: true },
      ],
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
      capabilities: [{ capability: "dependency.read", required: true }],
      resources: [],
    }),
  });

  assertEquals(result.ok, true);
});

Deno.test("callout permission helpers use authority capabilities and deployment bindings", () => {
  assertEquals(
    __testing__.serviceCapabilitiesForPermissions({
      contracts: [],
      surfaces: [],
      capabilities: [{ capability: "dependency.events", required: true }],
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
  const operationStorePublish = __testing__
    .serviceOperationStorePublishSubjects(
      "abcdefghijklmnop1234",
      ["service"],
    );
  assertEquals(
    operationStorePublish.includes(
      "$JS.API.STREAM.CREATE.KV_trellis_operations_abcdefghijklmnop",
    ),
    true,
  );
  assertEquals(
    __testing__.serviceOperationStorePublishSubjects(
      "abcdefghijklmnop1234",
      [],
    ),
    [],
  );
});

Deno.test("auth callout rejects service reconnect when global storage misses even if an offer exists", async () => {
  const result = await serviceDigestCheck({
    contractStorageMiss: true,
  });

  assertEquals(result, { ok: false, denial: "contract_changed" });
});

Deno.test("auth callout accepts service reconnect during offer stale grace window", async () => {
  const validated = await createTestContracts().validateContract(
    SERVICE_CONTRACT,
  );
  const result = await serviceDigestCheck({
    offerStaleAt: "2026-01-01T00:05:00.000Z",
  });

  assertEquals(result, {
    ok: true,
    value: {
      contractId: SERVICE_CONTRACT.id,
      contractDigest: validated.digest,
    },
  });
});

Deno.test("auth callout rejects service reconnect when deployment authority or current materialization is missing", async () => {
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
    await serviceDigestCheck({ materializedAuthority: null }),
    { ok: false, denial: "service_authority_miss" },
  );
  assertEquals(
    await serviceDigestCheck({
      materializedAuthority: materializedServiceAuthority({
        status: "pending",
      }),
    }),
    { ok: false, denial: "service_authority_miss" },
  );
});

Deno.test("service runtime permissions use materialized nats grants instead of broad contract-derived subjects", () => {
  const materializedAuthority = materializedServiceAuthority({
    grants: {
      capabilities: [{ capability: "worker.run" }],
      surfaces: [],
      nats: [{
        direction: "subscribe",
        subject: "rpc.v1.Worker.Run",
        requiredCapabilities: ["worker.run"],
        grantSource: "owned-surface",
      }],
    },
  });
  const capabilities = __testing__.materializedCapabilitiesForPermissions(
    materializedAuthority,
    ["service"],
  );

  assertEquals(capabilities, ["service", "worker.run"]);
  assertEquals(
    __testing__.servicePlatformPublishSubjects(capabilities),
    ["rpc.v1.Auth.Requests.Validate"],
  );
  assertEquals(
    __testing__.servicePlatformPublishSubjects(["worker.run"]),
    [],
  );
  assertEquals(
    __testing__.materializedNatsSubjectsForPermissions({
      materializedAuthority,
      direction: "subscribe",
      capabilities,
    }),
    ["rpc.v1.Worker.Run"],
  );
  assertEquals(
    __testing__.materializedNatsSubjectsForPermissions({
      materializedAuthority: materializedServiceAuthority({
        grants: {
          capabilities: [],
          surfaces: [],
          nats: [{
            direction: "subscribe",
            subject: "transfer.v1.upload.{serviceSessionPrefix}.*",
            requiredCapabilities: [],
            grantSource: "transfer",
          }],
        },
      }),
      direction: "subscribe",
      capabilities,
      serviceSessionPrefix: "session-prefix-1",
    }),
    ["transfer.v1.upload.session-prefix-1.*"],
  );
  assertEquals(
    __testing__.materializedNatsSubjectsForPermissions({
      materializedAuthority,
      direction: "publish",
      capabilities: [...capabilities, "worker.extra"],
    }).includes("rpc.v1.Worker.Extra"),
    false,
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
