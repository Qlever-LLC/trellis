import { assertEquals, assertRejects } from "@std/assert";
import { digestContractManifest } from "@qlever-llc/trellis/contracts";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { eq } from "drizzle-orm";

import {
  SqlDeploymentAuthorityRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlImplementationOfferRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
  SqlSessionRepository,
} from "../auth/storage.ts";
import {
  initializeTrellisStorageSchema,
  openTrellisStorageDb,
} from "../storage/db.ts";
import { contracts } from "../storage/schema.ts";
import { planUserContractApproval } from "../auth/approval/plan.ts";
import type { ContractsModule } from "./runtime.ts";
import type { ContractRecord } from "./schemas.ts";
import { SqlContractStorageRepository } from "./storage.ts";

class FailingGetManyContractStorageRepository
  extends SqlContractStorageRepository {
  override async getMany(
    _digests: Iterable<string>,
  ): Promise<ContractRecord[]> {
    throw new Error("contract lookup failed");
  }
}

async function withContractsModule(
  test: (
    module: ContractsModule,
    contractStorage: SqlContractStorageRepository,
    serviceDeploymentStorage: SqlServiceDeploymentRepository,
    deploymentAuthorityStorage: SqlDeploymentAuthorityRepository,
    implementationOfferStorage: SqlImplementationOfferRepository,
  ) => Promise<void>,
): Promise<void> {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-catalog-runtime-",
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    const { createContractsModule } = await import("./runtime.ts");
    await initializeTrellisStorageSchema(storage);
    const contractStorage = new SqlContractStorageRepository(storage.db);
    const serviceDeploymentStorage = new SqlServiceDeploymentRepository(
      storage.db,
    );
    const deploymentAuthorityStorage = new SqlDeploymentAuthorityRepository(
      storage.db,
    );
    const implementationOfferStorage = new SqlImplementationOfferRepository(
      storage.db,
    );
    await test(
      createContractsModule({
        builtinContracts: [],
        contractStorage,
        implementationOfferStorage,
        deploymentAuthorityStorage,
        serviceInstanceStorage: new SqlServiceInstanceRepository(storage.db),
        serviceDeploymentStorage,
        deviceDeploymentStorage: new SqlDeviceDeploymentRepository(storage.db),
        deviceInstanceStorage: new SqlDeviceInstanceRepository(storage.db),
      }),
      contractStorage,
      serviceDeploymentStorage,
      deploymentAuthorityStorage,
      implementationOfferStorage,
    );
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
}

type InstalledTestContract = Awaited<
  ReturnType<ContractsModule["installServiceContract"]>
>;

const TEST_NOW = "2026-01-01T00:00:00.000Z";

function testServiceDeployment(
  deploymentId: string,
  namespaces: string[],
  disabled = false,
): Parameters<SqlServiceDeploymentRepository["put"]>[0] {
  return {
    deploymentId,
    namespaces,
    disabled,
  };
}

function testDeviceDeployment(
  deploymentId: string,
  disabled = false,
): Parameters<SqlDeviceDeploymentRepository["put"]>[0] {
  return {
    deploymentId,
    disabled,
  };
}

type TestDeploymentAuthorityKind = "service" | "device";

type TestAuthorityDesiredState = {
  needs: {
    contracts: Array<{ contractId: string; required: boolean }>;
    surfaces: Array<never>;
    capabilities: Array<never>;
    resources: Array<never>;
  };
  capabilities: string[];
  resources: Array<never>;
  surfaces: Array<never>;
};

function authorityDesiredState(
  contractIds: string[],
): TestAuthorityDesiredState {
  return {
    needs: {
      contracts: contractIds.map((contractId) => ({
        contractId,
        required: true,
      })),
      surfaces: [],
      capabilities: [],
      resources: [],
    },
    capabilities: [],
    resources: [],
    surfaces: [],
  };
}

async function putDeploymentAuthority(
  storage: SqlDeploymentAuthorityRepository,
  deploymentId: string,
  kind: TestDeploymentAuthorityKind,
  contractIds: string[],
  disabled = false,
): Promise<void> {
  await storage.put({
    deploymentId,
    kind,
    disabled,
    desiredState: authorityDesiredState(contractIds),
    version: "1",
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
  });
}

async function putAcceptedOffer(
  storage: SqlImplementationOfferRepository,
  deploymentId: string,
  installed: InstalledTestContract,
  overrides: Partial<Parameters<SqlImplementationOfferRepository["put"]>[0]> =
    {},
): Promise<void> {
  await storage.put({
    offerId: `offer-${deploymentId}-${installed.digest}`,
    deploymentKind: "service",
    deploymentId,
    instanceId: `instance-${deploymentId}`,
    contractId: installed.id,
    contractDigest: installed.digest,
    lineageKey: `${deploymentId}:${installed.id}`,
    status: "accepted",
    liveness: "healthy",
    firstOfferedAt: TEST_NOW,
    acceptedAt: TEST_NOW,
    lastRefreshedAt: TEST_NOW,
    staleAt: null,
    expiresAt: null,
    ...overrides,
  });
}

function makeOperationContract(
  id: string,
  subject: string,
  version: `v${number}` = "v1",
  kind: TrellisContractV1["kind"] = "service",
): TrellisContractV1 {
  return {
    format: "trellis.contract.v1",
    id,
    displayName: id,
    description: `${id} test contract`,
    kind,
    schemas: {
      Input: { type: "object" },
      Progress: { type: "object" },
      Output: { type: "object" },
    },
    operations: {
      Refund: {
        version,
        subject,
        input: { schema: "Input" },
        progress: { schema: "Progress" },
        output: { schema: "Output" },
      },
    },
  };
}

function makeCachedOperationContractRecord(index: number): ContractRecord {
  const name = `Page${index.toString().padStart(3, "0")}`;
  const contract = makeOperationContract(
    `${name.toLowerCase()}@v1`,
    `operations.v1.${name}.Refund`,
  );
  return {
    digest: digestContractManifest(contract),
    id: contract.id,
    displayName: contract.displayName,
    description: contract.description,
    installedAt: new Date(TEST_NOW),
    contract: JSON.stringify(contract),
  };
}

Deno.test("contracts runtime does not treat installed inactive manifests as active subject ownership", async () => {
  await withContractsModule(async (
    module,
    contractStorage,
    serviceDeployments,
    authorities,
  ) => {
    const installed = await module.installServiceContract(
      makeOperationContract("billing@v1", "operations.v1.Billing.Refund"),
    );
    await serviceDeployments.put(
      testServiceDeployment("billing.default", ["Billing"]),
    );
    await putDeploymentAuthority(authorities, "billing.default", "service", [
      installed.id,
    ]);

    await module.installServiceContract(
      makeOperationContract("other@v1", "operations.v1.Billing.Refund"),
    );

    assertEquals(
      (await contractStorage.listPage({ limit: 10 })).map((entry) => entry.id)
        .sort(),
      [
        "billing@v1",
        "other@v1",
      ],
    );
    assertEquals((await module.getActiveCatalog()).contracts, []);
  });
});

Deno.test("contracts runtime rejects operation subject version mismatches", async () => {
  await withContractsModule(async (module, contractStorage) => {
    await assertRejects(
      async () => {
        await module.installServiceContract(
          makeOperationContract("billing@v1", "operations.v2.Billing.Refund"),
        );
      },
      Error,
      "must start with 'operations.v1.'",
    );

    assertEquals(await contractStorage.listPage({ limit: 10 }), []);
  });
});

Deno.test("contracts runtime lets app approval use known service contract without active service instance", async () => {
  await withContractsModule(
    async (module) => {
      const service = await module.installServiceContract(
        makeOperationContract("billing@v1", "operations.v1.Billing.Refund"),
      );

      await module.refreshActiveContracts();
      const plan = await planUserContractApproval(module, {
        format: "trellis.contract.v1",
        id: "console@v1",
        displayName: "Console",
        description: "Browser app",
        kind: "app",
        uses: {
          required: {
            billing: {
              contract: "billing@v1",
              operations: { call: ["Refund"] },
            },
          },
        },
      });

      assertEquals(plan.publishSubjects, [
        "operations.v1.Billing.Refund",
        "operations.v1.Billing.Refund.control",
      ]);
      assertEquals(
        (await module.getActiveCatalog()).contracts.map((entry) =>
          entry.digest
        ),
        [],
      );
    },
  );
});

Deno.test("contracts runtime rejects non-service service installs", async () => {
  await withContractsModule(async (module, contractStorage) => {
    await assertRejects(
      () =>
        module.installServiceContract(
          makeOperationContract("app@v1", "operations.v1.App.Run", "v1", "app"),
        ),
      Error,
      "service contract install requires kind 'service', got 'app'",
    );

    assertEquals(await contractStorage.listPage({ limit: 10 }), []);
  });
});

Deno.test("contracts runtime rejects non-device device installs", async () => {
  await withContractsModule(async (module, contractStorage) => {
    await assertRejects(
      () =>
        module.installDeviceContract(
          makeOperationContract(
            "service@v1",
            "operations.v1.Service.Run",
            "v1",
            "service",
          ),
        ),
      Error,
      "device contract install requires kind 'device', got 'service'",
    );

    assertEquals(await contractStorage.listPage({ limit: 10 }), []);
  });
});

Deno.test("contracts runtime rejects uses dependencies before persistence", async () => {
  await withContractsModule(async (module, contractStorage) => {
    const consumer = {
      format: "trellis.contract.v1",
      id: "portal@v1",
      displayName: "Portal",
      description: "Calls billing operations.",
      kind: "service",
      uses: {
        required: {
          billing: {
            contract: "billing@v1",
            operations: { call: ["Billing.Missing"] },
          },
        },
      },
    } satisfies TrellisContractV1;

    await assertRejects(
      () => module.installServiceContract(consumer),
      Error,
      "unknown contract 'billing@v1'",
    );

    assertEquals(await contractStorage.listPage({ limit: 10 }), []);
  });
});

Deno.test("contracts runtime validates uses against known contracts", async () => {
  await withContractsModule(async (
    module,
    contractStorage,
  ) => {
    const billing = await module.installServiceContract(
      makeOperationContract("billing@v1", "operations.v1.Billing.Refund"),
    );

    const badConsumer = {
      format: "trellis.contract.v1",
      id: "portal@v1",
      displayName: "Portal",
      description: "Calls billing operations.",
      kind: "service",
      uses: {
        required: {
          billing: {
            contract: "billing@v1",
            operations: { call: ["Billing.Missing"] },
          },
        },
      },
    } satisfies TrellisContractV1;

    await assertRejects(
      () => module.installServiceContract(badConsumer),
      Error,
      "missing operation 'Billing.Missing'",
    );

    const goodConsumer = {
      ...badConsumer,
      uses: {
        required: {
          billing: {
            contract: "billing@v1",
            operations: { call: ["Refund"] },
          },
        },
      },
    } satisfies TrellisContractV1;

    await module.installServiceContract(goodConsumer);

    assertEquals(
      (await contractStorage.listPage({ limit: 10 })).map((entry) => entry.id)
        .sort(),
      [
        "billing@v1",
        "portal@v1",
      ],
    );
    assertEquals(await module.getKnownContractsById(billing.id), [
      billing.contract,
    ]);
  });
});

Deno.test("contracts runtime treats grouped required uses as fail-closed", async () => {
  await withContractsModule(async (module, contractStorage) => {
    const uses = {
      required: {
        billing: {
          contract: "billing@v1",
          operations: { call: ["Refund"] },
        },
      },
    };
    const consumer = {
      format: "trellis.contract.v1",
      id: "portal@v1",
      displayName: "Portal",
      description: "Calls billing operations.",
      kind: "service",
      uses,
    };

    await assertRejects(
      () => module.installServiceContract(consumer),
      Error,
      "unknown contract 'billing@v1'",
    );

    assertEquals(await contractStorage.listPage({ limit: 10 }), []);
  });
});

Deno.test("contracts runtime allows grouped optional uses to be absent", async () => {
  await withContractsModule(
    async (module, contractStorage) => {
      const uses = {
        optional: {
          billing: {
            contract: "billing@v1",
            operations: { call: ["Refund"] },
          },
          feedService: {
            contract: "feed-service@v1",
            feeds: { subscribe: ["Device.Events"] },
          },
        },
      };
      const portal = await module.installServiceContract({
        format: "trellis.contract.v1",
        id: "portal@v1",
        displayName: "Portal",
        description: "Optionally calls billing operations.",
        kind: "service",
        uses,
      });
      await module.refreshActiveContracts();

      assertEquals(
        (await contractStorage.listPage({ limit: 10 })).map((entry) =>
          entry.id
        ),
        ["portal@v1"],
      );
      assertEquals(
        (await module.getActiveCatalog()).contracts.map((entry) =>
          entry.digest
        ),
        [],
      );
    },
  );
});

Deno.test("contracts runtime can refresh with known inactive uses", async () => {
  await withContractsModule(
    async (
      module,
      _contractStorage,
    ) => {
      const billing = await module.installServiceContract(
        makeOperationContract("billing@v1", "operations.v1.Billing.Refund"),
      );

      const portal = await module.installServiceContract({
        format: "trellis.contract.v1",
        id: "portal@v1",
        displayName: "Portal",
        description: "Calls billing operations.",
        kind: "service",
        uses: {
          required: {
            billing: {
              contract: "billing@v1",
              operations: { call: ["Refund"] },
            },
          },
        },
      });
      await module.refreshActiveContracts();

      assertEquals(
        (await module.getActiveCatalog()).contracts.map((entry) =>
          entry.digest
        ),
        [],
      );
      assertEquals(await module.getKnownContractsById(billing.id), [
        billing.contract,
      ]);
      assertEquals(await module.getKnownContractsById(portal.id), [
        portal.contract,
      ]);
    },
  );
});

Deno.test("contracts runtime fails closed when an active digest is missing", async () => {
  await withContractsModule(async (module) => {
    await module.refreshActiveContracts();
    await assertRejects(
      () =>
        module.validateActiveCatalog({ proposedDigests: ["missing-digest"] }),
      Error,
      "Unknown active contract digest 'missing-digest'",
    );
  });
});

Deno.test("contracts runtime treats missing active offer manifest as cache miss", async () => {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-catalog-runtime-missing-active-",
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    const { createContractsModule } = await import("./runtime.ts");
    await initializeTrellisStorageSchema(storage);
    const contractStorage = new SqlContractStorageRepository(storage.db);
    const serviceInstanceStorage = new SqlServiceInstanceRepository(storage.db);
    const serviceDeploymentStorage = new SqlServiceDeploymentRepository(
      storage.db,
    );
    const deviceDeploymentStorage = new SqlDeviceDeploymentRepository(
      storage.db,
    );
    const deploymentAuthorityStorage = new SqlDeploymentAuthorityRepository(
      storage.db,
    );
    const implementationOfferStorage = new SqlImplementationOfferRepository(
      storage.db,
    );
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      implementationOfferStorage,
      deploymentAuthorityStorage,
      serviceInstanceStorage,
      serviceDeploymentStorage,
      deviceDeploymentStorage,
      deviceInstanceStorage: new SqlDeviceInstanceRepository(storage.db),
    });
    await serviceDeploymentStorage.put(
      testServiceDeployment("service.default", ["Service"]),
    );
    await putDeploymentAuthority(
      deploymentAuthorityStorage,
      "service.default",
      "service",
      ["service@v1"],
    );
    await serviceInstanceStorage.put({
      instanceId: "svc_1",
      deploymentId: "service.default",
      instanceKey: "session-key",
      disabled: false,
      capabilities: ["service"],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await implementationOfferStorage.put({
      offerId: "offer-missing",
      deploymentKind: "service",
      deploymentId: "service.default",
      instanceId: "svc_1",
      contractId: "service@v1",
      contractDigest: "missing-digest",
      lineageKey: "service.default:service@v1",
      status: "accepted",
      liveness: "healthy",
      firstOfferedAt: TEST_NOW,
      acceptedAt: TEST_NOW,
      lastRefreshedAt: TEST_NOW,
      staleAt: null,
      expiresAt: null,
    });

    await module.refreshActiveContracts();

    assertEquals((await module.getActiveCatalog()).contracts, []);
    assertEquals(await module.getActiveCatalogIssues(), []);
    assertEquals(
      (await implementationOfferStorage.get("offer-missing"))?.offerId,
      "offer-missing",
    );
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});

Deno.test("contracts runtime excludes expired and stale implementation offers", async () => {
  await withContractsModule(async (
    module,
    _contractStorage,
    deployments,
    _authorities,
    offers,
  ) => {
    const expired = await module.installServiceContract(
      makeOperationContract("expired@v1", "operations.v1.Expired.Run"),
    );
    const stale = await module.installServiceContract(
      makeOperationContract("stale@v1", "operations.v1.Stale.Run"),
    );
    await deployments.put(testServiceDeployment("expired.default", [
      "Expired",
    ]));
    await deployments.put(testServiceDeployment("stale.default", ["Stale"]));
    await putAcceptedOffer(offers, "expired.default", expired, {
      expiresAt: "2025-01-01T00:00:00.000Z",
    });
    await putAcceptedOffer(offers, "stale.default", stale, {
      staleAt: "2025-01-01T00:00:00.000Z",
    });

    await module.refreshActiveContracts();

    assertEquals((await module.getActiveCatalog()).contracts, []);
  });
});

Deno.test("contracts runtime keeps compatible active offer digests", async () => {
  await withContractsModule(async (
    module,
    _contractStorage,
    deployments,
    _authorities,
    offers,
  ) => {
    const first = makeOperationContract(
      "billing@v1",
      "operations.v1.Billing.Refund",
    );
    const second = makeOperationContract(
      "billing@v1",
      "operations.v1.Billing.Refund",
    );
    second.operations = {
      ...second.operations,
      Ping: {
        version: "v1",
        subject: "operations.v1.Billing.Ping",
        input: { schema: "Input" },
        progress: { schema: "Progress" },
        output: { schema: "Output" },
      },
    };
    const firstInstalled = await module.installServiceContract(first);
    const secondInstalled = await module.installServiceContract(second);
    await deployments.put(testServiceDeployment("billing.default", [
      "Billing",
    ]));
    await putAcceptedOffer(offers, "billing.default", firstInstalled, {
      offerId: "offer-billing-first",
      instanceId: "svc_1",
    });
    await putAcceptedOffer(offers, "billing.default", secondInstalled, {
      offerId: "offer-billing-second",
      instanceId: "svc_2",
      lastRefreshedAt: "2026-01-01T00:00:01.000Z",
    });

    await module.refreshActiveContracts();

    assertEquals(
      (await module.getActiveCatalog()).contracts.map((entry) => entry.digest)
        .sort(),
      [firstInstalled.digest, secondInstalled.digest].sort(),
    );
    assertEquals(await module.getActiveCatalogIssues(), []);
  });
});

Deno.test("contracts runtime reports incompatible active implementation offers", async () => {
  await withContractsModule(async (
    module,
    _contractStorage,
    deployments,
    _authorities,
    offers,
  ) => {
    const first = makeOperationContract(
      "billing@v1",
      "operations.v1.Billing.Refund",
    );
    first.operations!.Refund!.capabilities = { call: ["billing.refund"] };
    const second = makeOperationContract(
      "billing@v1",
      "operations.v1.Billing.Refund",
    );
    second.operations!.Refund!.capabilities = {
      call: ["billing.refund.v2"],
    };
    const firstInstalled = await module.installServiceContract(first);
    const secondInstalled = await module.installServiceContract(second);
    await deployments.put(testServiceDeployment("billing.default", [
      "Billing",
    ]));
    await putAcceptedOffer(offers, "billing.default", firstInstalled, {
      offerId: "offer-billing-first",
      instanceId: "svc_1",
    });
    await putAcceptedOffer(offers, "billing.default", secondInstalled, {
      offerId: "offer-billing-second",
      instanceId: "svc_2",
      lastRefreshedAt: "2026-01-01T00:00:01.000Z",
    });

    await module.refreshActiveContracts();

    const issues = await module.getActiveCatalogIssues();
    assertEquals(issues.map((issue) => issue.kind), [
      "incompatible-active-contract",
    ]);
    assertEquals(issues[0]?.actions.map((action) => action.description), [
      "Withdraw or let the incompatible implementation offer expire so the current effective digest remains active.",
      "Withdraw the current effective offers and accept a compatible implementation offer set before making this digest effective.",
    ]);
  });
});

Deno.test("contracts runtime prunes invalid cached active manifests without deleting offers", async () => {
  await withContractsModule(async (
    module,
    contractStorage,
    deployments,
    _authorities,
    offers,
  ) => {
    await contractStorage.put({
      digest: "bad-digest",
      id: "service@v1",
      displayName: "Service",
      description: "Bad stored contract",
      installedAt: new Date(TEST_NOW),
      contract: JSON.stringify({
        format: "trellis.contract.v1",
        id: "service@v1",
        displayName: "Service",
        description: "Bad stored contract",
        kind: "not-a-kind",
      }),
    });
    await deployments.put(testServiceDeployment("service.default", [
      "Service",
    ]));
    await offers.put({
      offerId: "offer-bad",
      deploymentKind: "service",
      deploymentId: "service.default",
      instanceId: "svc_1",
      contractId: "service@v1",
      contractDigest: "bad-digest",
      lineageKey: "service.default:service@v1",
      status: "accepted",
      liveness: "healthy",
      firstOfferedAt: TEST_NOW,
      acceptedAt: TEST_NOW,
      lastRefreshedAt: TEST_NOW,
      staleAt: null,
      expiresAt: null,
    });

    await module.refreshActiveContracts();

    assertEquals((await module.getActiveCatalog()).contracts, []);
    assertEquals(await module.getActiveCatalogIssues(), []);
    assertEquals(await contractStorage.has("bad-digest"), false);
    assertEquals((await offers.get("offer-bad"))?.offerId, "offer-bad");
  });
});

Deno.test("contracts runtime hydrates active cached manifests despite stale projections", async () => {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-catalog-runtime-stale-projections-",
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    const { createContractsModule } = await import("./runtime.ts");
    await initializeTrellisStorageSchema(storage);
    const contractStorage = new SqlContractStorageRepository(storage.db);
    const serviceDeploymentStorage = new SqlServiceDeploymentRepository(
      storage.db,
    );
    const implementationOfferStorage = new SqlImplementationOfferRepository(
      storage.db,
    );
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      implementationOfferStorage,
      deploymentAuthorityStorage: new SqlDeploymentAuthorityRepository(
        storage.db,
      ),
      serviceInstanceStorage: new SqlServiceInstanceRepository(storage.db),
      serviceDeploymentStorage,
      deviceDeploymentStorage: new SqlDeviceDeploymentRepository(storage.db),
      deviceInstanceStorage: new SqlDeviceInstanceRepository(storage.db),
    });
    const installed = await module.installServiceContract(
      makeOperationContract("billing@v1", "operations.v1.Billing.Refund"),
    );
    await storage.db.update(contracts).set({
      resources: "{",
      analysisSummary: JSON.stringify({ namespaces: "stale" }),
      analysis: JSON.stringify({ stale: true }),
    }).where(eq(contracts.digest, installed.digest));
    await serviceDeploymentStorage.put(
      testServiceDeployment("billing.default", [
        "Billing",
      ]),
    );
    await putAcceptedOffer(
      implementationOfferStorage,
      "billing.default",
      installed,
    );

    await module.refreshActiveContracts();

    assertEquals(
      (await module.getActiveCatalog()).contracts.map((entry) => entry.digest),
      [installed.digest],
    );
    assertEquals(await module.getActiveCatalogIssues(), []);
    await assertRejects(
      () => contractStorage.get(installed.digest),
      Error,
      "Invalid JSON stored for contract resources",
    );
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});

Deno.test("contracts runtime repairs corrupt cached manifest on full manifest install", async () => {
  await withContractsModule(async (module, contractStorage) => {
    const contract = makeOperationContract(
      "billing@v1",
      "operations.v1.Billing.Refund",
    );
    const installed = await module.installServiceContract(contract);
    await contractStorage.put({
      digest: installed.digest,
      id: installed.id,
      displayName: "Corrupt Billing",
      description: "Corrupt cached contract",
      installedAt: new Date(TEST_NOW),
      contract: "{not json",
    });

    await module.installServiceContract(contract);

    assertEquals(await module.getKnownContract(installed.digest), contract);
    const stored = await contractStorage.getManifest(installed.digest);
    assertEquals(JSON.parse(stored?.contract ?? "null"), contract);
    const repaired = await contractStorage.get(installed.digest);
    assertEquals(repaired?.displayName, contract.displayName);
    assertEquals(repaired?.description, contract.description);
  });
});

Deno.test("contracts runtime prunes invalid cached manifests from known lookups", async () => {
  await withContractsModule(async (module, contractStorage) => {
    await contractStorage.put({
      digest: "bad-known-digest",
      id: "known@v1",
      displayName: "Known",
      description: "Bad stored contract",
      installedAt: new Date(TEST_NOW),
      contract: "{not json",
    });

    assertEquals(await module.getKnownContract("bad-known-digest"), undefined);
    assertEquals(await contractStorage.has("bad-known-digest"), false);

    await contractStorage.put({
      digest: "bad-known-id-digest",
      id: "known@v1",
      displayName: "Known",
      description: "Bad stored contract",
      installedAt: new Date(TEST_NOW),
      contract: "{not json",
    });

    assertEquals(await module.getKnownContractsById("known@v1"), []);
    assertEquals(await contractStorage.has("bad-known-id-digest"), false);
  });
});

Deno.test("contracts runtime reports invalid cached manifest pruning counts", async () => {
  await withContractsModule(async (module, contractStorage) => {
    const installed = await module.installServiceContract(
      makeOperationContract("billing@v1", "operations.v1.Billing.Refund"),
    );
    await contractStorage.put({
      digest: "bad-digest",
      id: "service@v1",
      displayName: "Service",
      description: "Bad stored contract",
      installedAt: new Date(TEST_NOW),
      contract: "{not json",
    });

    assertEquals(await module.pruneInvalidCachedContracts(), {
      scanned: 2,
      valid: 1,
      pruned: 1,
    });
    assertEquals(await contractStorage.has(installed.digest), true);
    assertEquals(await contractStorage.has("bad-digest"), false);
  });
});

Deno.test("contracts runtime prunes invalid cached manifests across paginated deletion", async () => {
  await withContractsModule(async (module, contractStorage) => {
    const validRecords = Array.from(
      { length: 121 },
      (_value, index) => makeCachedOperationContractRecord(index),
    );
    for (const record of validRecords) {
      await contractStorage.put(record);
    }

    const sortedValidDigests = validRecords.map((record) => record.digest)
      .sort();
    const invalidDigests = {
      beginning: "-",
      middle: `${sortedValidDigests[48]}-`,
      pageBoundary: `${sortedValidDigests[97]}-`,
      end: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    };
    for (const [label, digest] of Object.entries(invalidDigests)) {
      await contractStorage.put({
        digest,
        id: `invalid-${label}@v1`,
        displayName: `Invalid ${label}`,
        description: `Invalid ${label} cached contract`,
        installedAt: new Date(TEST_NOW),
        contract: "{not json",
      });
    }

    const beforeDigests = (await contractStorage.listManifestPage({
      limit: 200,
    })).map((record) => record.digest);
    assertEquals(beforeDigests.length, 125);
    assertEquals(beforeDigests[0], invalidDigests.beginning);
    assertEquals(beforeDigests[50], invalidDigests.middle);
    assertEquals(beforeDigests[100], invalidDigests.pageBoundary);
    assertEquals(beforeDigests[124], invalidDigests.end);

    assertEquals(await module.pruneInvalidCachedContracts(), {
      scanned: 125,
      valid: 121,
      pruned: 4,
    });
    assertEquals(
      (await contractStorage.listManifestPage({ limit: 200 })).map((record) =>
        record.digest
      ),
      sortedValidDigests,
    );
  });
});

Deno.test("contracts runtime reports divergent non-builtin implementation offers", async () => {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-catalog-runtime-divergent-active-",
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    const { createContractsModule } = await import("./runtime.ts");
    await initializeTrellisStorageSchema(storage);
    const contractStorage = new SqlContractStorageRepository(storage.db);
    const serviceInstanceStorage = new SqlServiceInstanceRepository(storage.db);
    const serviceDeploymentStorage = new SqlServiceDeploymentRepository(
      storage.db,
    );
    const deploymentAuthorityStorage = new SqlDeploymentAuthorityRepository(
      storage.db,
    );
    const implementationOfferStorage = new SqlImplementationOfferRepository(
      storage.db,
    );
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      implementationOfferStorage,
      deploymentAuthorityStorage,
      serviceInstanceStorage,
      serviceDeploymentStorage,
      deviceDeploymentStorage: new SqlDeviceDeploymentRepository(storage.db),
      deviceInstanceStorage: new SqlDeviceInstanceRepository(storage.db),
    });
    const first = makeOperationContract(
      "billing@v1",
      "operations.v1.Billing.Refund",
    );
    first.operations!.Refund!.capabilities = { call: ["billing.refund"] };
    const second = makeOperationContract(
      "billing@v1",
      "operations.v1.Billing.Refund",
    );
    second.operations!.Refund!.capabilities = {
      call: ["billing.refund.v2"],
    };
    const firstInstalled = await module.installServiceContract(first);
    const secondInstalled = await module.installServiceContract(second);

    await serviceDeploymentStorage.put(
      testServiceDeployment("service.default", ["Billing"]),
    );
    await putDeploymentAuthority(
      deploymentAuthorityStorage,
      "service.default",
      "service",
      ["billing@v1"],
    );
    await serviceInstanceStorage.put({
      instanceId: "svc_1",
      deploymentId: "service.default",
      instanceKey: "session-key-1",
      disabled: false,
      capabilities: ["service"],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await serviceInstanceStorage.put({
      instanceId: "svc_2",
      deploymentId: "service.default",
      instanceKey: "session-key-2",
      disabled: false,
      capabilities: ["service"],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await putAcceptedOffer(
      implementationOfferStorage,
      "service.default",
      firstInstalled,
      {
        offerId: "offer-billing-first",
        instanceId: "svc_1",
      },
    );
    await putAcceptedOffer(
      implementationOfferStorage,
      "service.default",
      secondInstalled,
      {
        offerId: "offer-billing-second",
        instanceId: "svc_2",
        lastRefreshedAt: "2026-01-01T00:00:01.000Z",
      },
    );

    await module.refreshActiveContracts();

    assertEquals(
      (await module.getActiveCatalog()).contracts.map((entry) => entry.digest),
      [
        firstInstalled.digest,
      ],
    );
    assertEquals(
      (await module.getActiveCatalogIssues()).map((issue) => issue.kind),
      ["incompatible-active-contract"],
    );
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});

Deno.test("contracts runtime keeps compatible duplicate non-builtin implementation offers", async () => {
  await withContractsModule(
    async (module, _contracts, deployments, authorities, offers) => {
      const first = makeOperationContract(
        "billing@v1",
        "operations.v1.Billing.Refund",
      );
      const second = makeOperationContract(
        "billing@v1",
        "operations.v1.Billing.Refund",
      );
      second.schemas = {
        ...second.schemas,
        Extra: { type: "string" },
      };
      second.exports = { schemas: ["Extra"] };
      const firstInstalled = await module.installServiceContract(first);
      const secondInstalled = await module.installServiceContract(second);

      await deployments.put(
        testServiceDeployment("service.default", ["Billing"]),
      );
      await putDeploymentAuthority(authorities, "service.default", "service", [
        "billing@v1",
      ]);
      await putAcceptedOffer(offers, "service.default", firstInstalled, {
        offerId: "offer-billing-first",
        firstOfferedAt: "2026-01-01T00:00:10.000Z",
      });
      await putAcceptedOffer(offers, "service.default", secondInstalled, {
        offerId: "offer-billing-second",
        firstOfferedAt: "2026-01-01T00:00:20.000Z",
      });
      await deployments.put(
        testServiceDeployment("service.other", ["Billing"]),
      );
      await putDeploymentAuthority(authorities, "service.other", "service", [
        "billing@v1",
      ]);
      await putAcceptedOffer(offers, "service.other", secondInstalled, {
        offerId: "offer-billing-other",
        firstOfferedAt: "2026-01-01T00:00:05.000Z",
        instanceId: "instance-service.other",
      });

      await module.refreshActiveContracts();

      assertEquals(
        (await module.getActiveCatalog()).contracts.map((entry) =>
          entry.digest
        ),
        [...new Set([firstInstalled.digest, secondInstalled.digest])].sort(),
      );
      assertEquals(await module.getActiveCatalogIssues(), []);
    },
  );
});

Deno.test("contracts runtime refresh ignores stale deployment digests for built-in lineages", async () => {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-catalog-runtime-builtin-replace-",
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    const { createContractsModule } = await import("./runtime.ts");
    await initializeTrellisStorageSchema(storage);
    const contractStorage = new SqlContractStorageRepository(storage.db);
    const serviceInstanceStorage = new SqlServiceInstanceRepository(storage.db);
    const serviceDeploymentStorage = new SqlServiceDeploymentRepository(
      storage.db,
    );
    const deploymentAuthorityStorage = new SqlDeploymentAuthorityRepository(
      storage.db,
    );
    const current = makeOperationContract(
      "trellis.builtin@v1",
      "operations.v1.TrellisBuiltin.Refresh",
    );
    current.operations!.Refund!.capabilities = {
      call: ["trellis.builtin.refresh.v2"],
    };
    const currentDigest = digestContractManifest(current);
    const module = createContractsModule({
      builtinContracts: [{ digest: currentDigest, contract: current }],
      contractStorage,
      deploymentAuthorityStorage,
      serviceInstanceStorage,
      serviceDeploymentStorage,
      deviceDeploymentStorage: new SqlDeviceDeploymentRepository(storage.db),
      deviceInstanceStorage: new SqlDeviceInstanceRepository(storage.db),
    });
    await serviceDeploymentStorage.put(
      testServiceDeployment("trellis.builtin", ["TrellisBuiltin"]),
    );

    await module.refreshActiveContracts();

    assertEquals(
      (await module.getActiveCatalog()).contracts.map((entry) => entry.digest),
      [currentDigest],
    );
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});

Deno.test("contracts runtime dry-run rejects incompatible staged active digests without mutating active state", async () => {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-catalog-runtime-dry-run-",
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    const { createContractsModule } = await import("./runtime.ts");
    await initializeTrellisStorageSchema(storage);
    const contractStorage = new SqlContractStorageRepository(storage.db);
    const serviceInstanceStorage = new SqlServiceInstanceRepository(storage.db);
    const serviceDeploymentStorage = new SqlServiceDeploymentRepository(
      storage.db,
    );
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      deploymentAuthorityStorage: new SqlDeploymentAuthorityRepository(
        storage.db,
      ),
      serviceInstanceStorage,
      serviceDeploymentStorage,
      deviceDeploymentStorage: new SqlDeviceDeploymentRepository(storage.db),
      deviceInstanceStorage: new SqlDeviceInstanceRepository(storage.db),
    });
    const first = makeOperationContract(
      "billing@v1",
      "operations.v1.Billing.Refund",
    );
    first.operations!.Refund!.capabilities = { call: ["billing.refund"] };
    const second = makeOperationContract(
      "billing@v1",
      "operations.v1.Billing.Refund",
    );
    second.operations!.Refund!.capabilities = {
      call: ["billing.refund.v2"],
    };
    const firstInstalled = await module.installServiceContract(first);
    const secondInstalled = await module.installServiceContract(second);

    await assertRejects(
      () =>
        module.validateActiveCatalog({
          proposedDigests: [firstInstalled.digest, secondInstalled.digest],
          stagedServiceDeployments: [
            testServiceDeployment("service.default", ["Billing"]),
          ],
          stagedServiceInstances: [
            {
              instanceId: "svc_1",
              deploymentId: "service.default",
              instanceKey: "session-key-1",
              disabled: false,
              capabilities: ["service"],
              createdAt: "2026-01-01T00:00:00.000Z",
            },
            {
              instanceId: "svc_2",
              deploymentId: "service.default",
              instanceKey: "session-key-2",
              disabled: false,
              capabilities: ["service"],
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      Error,
      "different capabilities",
    );

    assertEquals(
      (await module.getActiveCatalog()).contracts.map((entry) => entry.digest),
      [],
    );
    assertEquals(await serviceDeploymentStorage.listPage({ limit: 10 }), []);
    assertEquals(await serviceInstanceStorage.listPage({ limit: 10 }), []);
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});

Deno.test("contracts runtime strict validation rejects proposed active uses dependencies", async () => {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-catalog-runtime-active-uses-",
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    const { createContractsModule } = await import("./runtime.ts");
    await initializeTrellisStorageSchema(storage);
    const contractStorage = new SqlContractStorageRepository(storage.db);
    const serviceInstanceStorage = new SqlServiceInstanceRepository(storage.db);
    const serviceDeploymentStorage = new SqlServiceDeploymentRepository(
      storage.db,
    );
    const deploymentAuthorityStorage = new SqlDeploymentAuthorityRepository(
      storage.db,
    );
    const implementationOfferStorage = new SqlImplementationOfferRepository(
      storage.db,
    );
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      implementationOfferStorage,
      deploymentAuthorityStorage,
      serviceInstanceStorage,
      serviceDeploymentStorage,
      deviceDeploymentStorage: new SqlDeviceDeploymentRepository(storage.db),
      deviceInstanceStorage: new SqlDeviceInstanceRepository(storage.db),
    });
    const billing = await module.installServiceContract(
      makeOperationContract("billing@v1", "operations.v1.Billing.Refund"),
    );
    const now = "2026-01-01T00:00:00.000Z";
    await serviceDeploymentStorage.put(
      testServiceDeployment("billing.default", ["Billing"]),
    );
    await putDeploymentAuthority(
      deploymentAuthorityStorage,
      "billing.default",
      "service",
      [billing.id],
    );
    await serviceInstanceStorage.put({
      instanceId: "svc_billing",
      deploymentId: "billing.default",
      instanceKey: "billing-session-key",
      disabled: false,
      capabilities: ["service"],
      createdAt: now,
    });
    await putAcceptedOffer(
      implementationOfferStorage,
      "billing.default",
      billing,
      {
        instanceId: "svc_billing",
      },
    );
    const portal = await module.installServiceContract(
      {
        format: "trellis.contract.v1",
        id: "portal@v1",
        displayName: "Portal",
        description: "Calls billing operations.",
        kind: "service",
        uses: {
          required: {
            billing: {
              contract: "billing@v1",
              operations: { call: ["Refund"] },
            },
          },
        },
      } satisfies TrellisContractV1,
    );
    await module.refreshActiveContracts();

    await serviceDeploymentStorage.put(
      testServiceDeployment("billing.default", ["Billing"], true),
    );
    await putDeploymentAuthority(
      deploymentAuthorityStorage,
      "billing.default",
      "service",
      [billing.id],
      true,
    );
    await putAcceptedOffer(
      implementationOfferStorage,
      "billing.default",
      billing,
      {
        instanceId: "svc_billing",
        staleAt: "2025-01-01T00:00:00.000Z",
      },
    );
    await serviceDeploymentStorage.put(
      testServiceDeployment("portal.default", ["Portal"]),
    );
    await putDeploymentAuthority(
      deploymentAuthorityStorage,
      "portal.default",
      "service",
      [portal.id],
    );
    await serviceInstanceStorage.put({
      instanceId: "svc_portal",
      deploymentId: "portal.default",
      instanceKey: "portal-session-key",
      disabled: false,
      capabilities: ["service"],
      createdAt: now,
    });
    await putAcceptedOffer(
      implementationOfferStorage,
      "portal.default",
      portal,
      {
        instanceId: "svc_portal",
      },
    );

    await module.refreshActiveContracts();
    assertEquals(
      (await module.getActiveCatalog()).contracts.map((entry) => entry.digest),
      [],
    );
    assertEquals(
      (await module.getActiveCatalogIssues()).map((issue) => issue.kind),
      ["invalid-active-contract-uses"],
    );
    await assertRejects(
      () => module.validateActiveCatalog({ proposedDigests: [portal.digest] }),
      Error,
      "inactive contract 'billing@v1'",
    );
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});

Deno.test("contracts runtime ignores unrelated offers when persisted context cannot be loaded", async () => {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-catalog-runtime-list-fail-",
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    const { createContractsModule } = await import("./runtime.ts");
    await initializeTrellisStorageSchema(storage);
    const contractStorage = new FailingGetManyContractStorageRepository(
      storage.db,
    );
    const serviceDeploymentStorage = new SqlServiceDeploymentRepository(
      storage.db,
    );
    const deploymentAuthorityStorage = new SqlDeploymentAuthorityRepository(
      storage.db,
    );
    const implementationOfferStorage = new SqlImplementationOfferRepository(
      storage.db,
    );
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      implementationOfferStorage,
      deploymentAuthorityStorage,
      serviceInstanceStorage: new SqlServiceInstanceRepository(storage.db),
      serviceDeploymentStorage,
      deviceDeploymentStorage: new SqlDeviceDeploymentRepository(storage.db),
      deviceInstanceStorage: new SqlDeviceInstanceRepository(storage.db),
    });
    const activeContract = makeOperationContract(
      "active@v1",
      "operations.v1.Active.Run",
    );
    const active = await module.installServiceContract(activeContract);
    await serviceDeploymentStorage.put(
      testServiceDeployment("active.default", ["Active"]),
    );
    await putDeploymentAuthority(
      deploymentAuthorityStorage,
      "active.default",
      "service",
      [activeContract.id],
    );
    await putAcceptedOffer(
      implementationOfferStorage,
      "active.default",
      active,
      {
        offerId: "offer-active",
      },
    );

    const billing = await module.installServiceContract(
      makeOperationContract("billing@v1", "operations.v1.Billing.Refund"),
    );
    assertEquals(billing.id, "billing@v1");
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});

Deno.test("contracts runtime does not activate contracts from user sessions", async () => {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-catalog-runtime-session-",
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    const { createContractsModule } = await import("./runtime.ts");
    await initializeTrellisStorageSchema(storage);
    const contractStorage = new SqlContractStorageRepository(storage.db);
    const serviceInstanceStorage = new SqlServiceInstanceRepository(storage.db);
    const serviceDeploymentStorage = new SqlServiceDeploymentRepository(
      storage.db,
    );
    const deviceInstanceStorage = new SqlDeviceInstanceRepository(storage.db);
    const deviceDeploymentStorage = new SqlDeviceDeploymentRepository(
      storage.db,
    );
    const sessionStorage = new SqlSessionRepository(storage.db);
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      deploymentAuthorityStorage: new SqlDeploymentAuthorityRepository(
        storage.db,
      ),
      serviceInstanceStorage,
      serviceDeploymentStorage,
      deviceDeploymentStorage,
      deviceInstanceStorage,
    });
    const validated = await module.validateContract({
      format: "trellis.contract.v1",
      id: "session-only@v1",
      displayName: "Session Only App",
      description: "App contract bound only to a user session.",
      kind: "app",
    });
    await contractStorage.put({
      digest: validated.digest,
      id: validated.contract.id,
      displayName: validated.contract.displayName,
      description: validated.contract.description,
      installedAt: new Date(),
      contract: validated.canonical,
    });
    const now = new Date();
    await sessionStorage.put("user-session", {
      type: "user",
      userId: "user-session",
      identity: {
        identityId: "github.user-session",
        provider: "github",
        subject: "user-session",
      },
      email: "user@example.com",
      name: "User Session",
      createdAt: now,
      lastAuth: now,
      participantKind: "app",
      contractDigest: validated.digest,
      contractId: validated.contract.id,
      contractDisplayName: validated.contract.displayName,
      contractDescription: validated.contract.description,
      delegatedCapabilities: [],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: [],
    });

    const refreshedModule = createContractsModule({
      builtinContracts: [],
      contractStorage,
      deploymentAuthorityStorage: new SqlDeploymentAuthorityRepository(
        storage.db,
      ),
      serviceInstanceStorage,
      serviceDeploymentStorage,
      deviceDeploymentStorage: new SqlDeviceDeploymentRepository(storage.db),
      deviceInstanceStorage,
    });
    await refreshedModule.refreshActiveContracts();

    assertEquals(
      (await refreshedModule.getActiveCatalog()).contracts,
      [],
    );
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});

Deno.test("contracts runtime keeps service deployment records cold without active offers", async () => {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-catalog-runtime-deployment-",
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    const { createContractsModule } = await import("./runtime.ts");
    await initializeTrellisStorageSchema(storage);
    const contractStorage = new SqlContractStorageRepository(storage.db);
    const serviceInstanceStorage = new SqlServiceInstanceRepository(storage.db);
    const serviceDeploymentStorage = new SqlServiceDeploymentRepository(
      storage.db,
    );
    const deviceInstanceStorage = new SqlDeviceInstanceRepository(storage.db);
    const deviceDeploymentStorage = new SqlDeviceDeploymentRepository(
      storage.db,
    );
    const deploymentAuthorityStorage = new SqlDeploymentAuthorityRepository(
      storage.db,
    );
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      deploymentAuthorityStorage,
      serviceInstanceStorage,
      serviceDeploymentStorage,
      deviceDeploymentStorage,
      deviceInstanceStorage,
    });
    const installed = await module.installServiceContract(
      makeOperationContract("service@v1", "operations.v1.Service.Run"),
    );
    await serviceDeploymentStorage.put(
      testServiceDeployment("service.default", ["Service"]),
    );
    await putDeploymentAuthority(
      deploymentAuthorityStorage,
      "service.default",
      "service",
      [installed.id],
    );

    await module.refreshActiveContracts();

    assertEquals(
      (await module.getActiveCatalog()).contracts.map((entry) => entry.digest),
      [],
    );
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});

Deno.test("contracts runtime ignores offer-only non-builtin manifests", async () => {
  await withContractsModule(
    async (
      module,
      contractStorage,
      serviceDeploymentStorage,
      deploymentAuthorityStorage,
    ) => {
      const validated = await module.validateContract(
        makeOperationContract("offer-only@v1", "operations.v1.OfferOnly.Run"),
      );
      await serviceDeploymentStorage.put(
        testServiceDeployment("service.offer", ["OfferOnly"]),
      );
      await putDeploymentAuthority(
        deploymentAuthorityStorage,
        "service.offer",
        "service",
        [validated.contract.id],
      );

      await module.refreshActiveContracts();

      assertEquals(await contractStorage.listPage({ limit: 10 }), []);
      assertEquals((await module.getActiveCatalog()).contracts, []);
      assertEquals(await module.getActiveCatalogIssues(), []);
      assertEquals(await module.validateActiveCatalog(), []);
    },
  );
});

Deno.test("contracts runtime keeps enabled service and device deployment records cold without offers", async () => {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-catalog-runtime-instances-",
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    const { createContractsModule } = await import("./runtime.ts");
    await initializeTrellisStorageSchema(storage);
    const contractStorage = new SqlContractStorageRepository(storage.db);
    const serviceInstanceStorage = new SqlServiceInstanceRepository(storage.db);
    const serviceDeploymentStorage = new SqlServiceDeploymentRepository(
      storage.db,
    );
    const deviceInstanceStorage = new SqlDeviceInstanceRepository(storage.db);
    const deviceDeploymentStorage = new SqlDeviceDeploymentRepository(
      storage.db,
    );
    const deploymentAuthorityStorage = new SqlDeploymentAuthorityRepository(
      storage.db,
    );
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      deploymentAuthorityStorage,
      serviceInstanceStorage,
      serviceDeploymentStorage,
      deviceDeploymentStorage,
      deviceInstanceStorage,
    });
    const service = await module.installServiceContract(
      makeOperationContract("service@v1", "operations.v1.Service.Run"),
    );
    const device = await module.installDeviceContract(
      makeOperationContract(
        "device@v1",
        "operations.v1.Device.Run",
        "v1",
        "device",
      ),
    );
    const now = "2026-01-01T00:00:00.000Z";
    await serviceInstanceStorage.put({
      instanceId: "svc_1",
      deploymentId: "service.default",
      instanceKey: "session-key",
      disabled: false,
      capabilities: ["service"],
      createdAt: now,
    });
    await serviceDeploymentStorage.put(
      testServiceDeployment("service.default", ["Service"]),
    );
    await putDeploymentAuthority(
      deploymentAuthorityStorage,
      "service.default",
      "service",
      [service.id],
    );
    await deviceDeploymentStorage.put(testDeviceDeployment("device.default"));
    await putDeploymentAuthority(
      deploymentAuthorityStorage,
      "device.default",
      "device",
      [device.id],
    );
    await module.refreshActiveContracts();

    assertEquals(
      (await module.getActiveCatalog()).contracts.map((entry) => entry.digest)
        .sort(),
      [],
    );
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});

Deno.test("contracts runtime excludes stale offers for disabled parent deployments", async () => {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-catalog-runtime-disabled-parents-",
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    const { createContractsModule } = await import("./runtime.ts");
    await initializeTrellisStorageSchema(storage);
    const contractStorage = new SqlContractStorageRepository(storage.db);
    const serviceInstanceStorage = new SqlServiceInstanceRepository(storage.db);
    const serviceDeploymentStorage = new SqlServiceDeploymentRepository(
      storage.db,
    );
    const deviceDeploymentStorage = new SqlDeviceDeploymentRepository(
      storage.db,
    );
    const deviceInstanceStorage = new SqlDeviceInstanceRepository(storage.db);
    const deploymentAuthorityStorage = new SqlDeploymentAuthorityRepository(
      storage.db,
    );
    const implementationOfferStorage = new SqlImplementationOfferRepository(
      storage.db,
    );
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      implementationOfferStorage,
      deploymentAuthorityStorage,
      serviceInstanceStorage,
      serviceDeploymentStorage,
      deviceDeploymentStorage,
      deviceInstanceStorage,
    });
    const service = await module.installServiceContract(
      makeOperationContract("disabled-service@v1", "operations.v1.Service.Off"),
    );
    const device = await module.installDeviceContract(
      makeOperationContract(
        "disabled-device@v1",
        "operations.v1.Device.Off",
        "v1",
        "device",
      ),
    );
    const now = "2026-01-01T00:00:00.000Z";
    await serviceDeploymentStorage.put(
      testServiceDeployment("service.disabled", ["Service"], true),
    );
    await putDeploymentAuthority(
      deploymentAuthorityStorage,
      "service.disabled",
      "service",
      [service.id],
      true,
    );
    await serviceInstanceStorage.put({
      instanceId: "svc_disabled",
      deploymentId: "service.disabled",
      instanceKey: "session-key",
      disabled: false,
      capabilities: ["service"],
      createdAt: now,
    });
    await deviceDeploymentStorage.put(
      testDeviceDeployment("device.disabled", true),
    );
    await putDeploymentAuthority(
      deploymentAuthorityStorage,
      "device.disabled",
      "device",
      [device.id],
      true,
    );
    await putAcceptedOffer(
      implementationOfferStorage,
      "service.disabled",
      service,
      {
        instanceId: "svc_disabled",
        staleAt: "2025-01-01T00:00:00.000Z",
      },
    );
    await putAcceptedOffer(
      implementationOfferStorage,
      "device.disabled",
      device,
      {
        deploymentKind: "device",
        instanceId: "dev_disabled",
        staleAt: "2025-01-01T00:00:00.000Z",
      },
    );
    await deviceInstanceStorage.put({
      instanceId: "dev_disabled",
      publicIdentityKey: "public-key",
      deploymentId: "device.disabled",
      state: "activated",
      createdAt: now,
      activatedAt: now,
      revokedAt: null,
    });

    await module.refreshActiveContracts();

    assertEquals((await module.getActiveCatalog()).contracts, []);
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});
