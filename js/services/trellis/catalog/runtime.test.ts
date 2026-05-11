import { assertEquals, assertRejects } from "@std/assert";
import { digestContractManifest } from "@qlever-llc/trellis/contracts";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";

import {
  SqlDeploymentContractEvidenceRepository,
  SqlDeploymentEnvelopeRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
  SqlSessionRepository,
} from "../auth/storage.ts";
import {
  initializeTrellisStorageSchema,
  openTrellisStorageDb,
} from "../storage/db.ts";
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
    deploymentContractEvidenceStorage: SqlDeploymentContractEvidenceRepository,
    deploymentEnvelopeStorage: SqlDeploymentEnvelopeRepository,
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
    const deploymentContractEvidenceStorage =
      new SqlDeploymentContractEvidenceRepository(storage.db);
    const deploymentEnvelopeStorage = new SqlDeploymentEnvelopeRepository(
      storage.db,
    );
    await test(
      createContractsModule({
        builtinContracts: [],
        contractStorage,
        deploymentContractEvidenceStorage,
        deploymentEnvelopeStorage,
        serviceInstanceStorage: new SqlServiceInstanceRepository(storage.db),
        serviceDeploymentStorage,
        deviceDeploymentStorage: new SqlDeviceDeploymentRepository(storage.db),
        deviceInstanceStorage: new SqlDeviceInstanceRepository(storage.db),
      }),
      contractStorage,
      serviceDeploymentStorage,
      deploymentContractEvidenceStorage,
      deploymentEnvelopeStorage,
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

type TestDeploymentEnvelopeKind = "service" | "device";

type TestEnvelopeBoundary = {
  contracts: Array<{ contractId: string; required: boolean }>;
  surfaces: Array<never>;
  capabilities: string[];
  resources: Array<never>;
};

function envelopeBoundary(contractIds: string[]): TestEnvelopeBoundary {
  return {
    contracts: contractIds.map((contractId) => ({
      contractId,
      required: true,
    })),
    surfaces: [],
    capabilities: [],
    resources: [],
  };
}

async function putDeploymentEnvelope(
  storage: SqlDeploymentEnvelopeRepository,
  deploymentId: string,
  kind: TestDeploymentEnvelopeKind,
  contractIds: string[],
  disabled = false,
): Promise<void> {
  await storage.put({
    deploymentId,
    kind,
    disabled,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    boundary: envelopeBoundary(contractIds),
  });
}

function contractEvidenceJson(
  contract: TrellisContractV1,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(contract));
}

async function putDeploymentEvidence(
  storage: SqlDeploymentContractEvidenceRepository,
  deploymentId: string,
  installed: InstalledTestContract,
): Promise<void> {
  await storage.put({
    deploymentId,
    contractId: installed.id,
    contractDigest: installed.digest,
    contract: contractEvidenceJson(installed.contract),
    firstSeenAt: TEST_NOW,
    lastSeenAt: TEST_NOW,
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

Deno.test("contracts runtime preflights active operation subject collisions before persistence", async () => {
  await withContractsModule(async (
    module,
    contractStorage,
    serviceDeployments,
    evidence,
    envelopes,
  ) => {
    const installed = await module.installServiceContract(
      makeOperationContract("billing@v1", "operations.v1.Billing.Refund"),
    );
    await serviceDeployments.put(
      testServiceDeployment("billing.default", ["Billing"]),
    );
    await putDeploymentEnvelope(envelopes, "billing.default", "service", [
      installed.id,
    ]);
    await putDeploymentEvidence(evidence, "billing.default", installed);

    await assertRejects(
      async () => {
        await module.installServiceContract(
          makeOperationContract("other@v1", "operations.v1.Billing.Refund"),
        );
      },
      Error,
      "Operation subject 'operations.v1.Billing.Refund' already owned by",
    );

    assertEquals(
      (await contractStorage.listPage({ limit: 10 })).map((entry) => entry.id),
      [
        "billing@v1",
      ],
    );
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

Deno.test("contracts runtime lets app approval use evidenced service contract without service instance", async () => {
  await withContractsModule(
    async (module, _contractStorage, deployments, evidence, envelopes) => {
      const service = await module.installServiceContract(
        makeOperationContract("billing@v1", "operations.v1.Billing.Refund"),
      );
      await deployments.put(
        testServiceDeployment("billing.default", ["Billing"]),
      );
      await putDeploymentEnvelope(envelopes, "billing.default", "service", [
        service.id,
      ]);
      await putDeploymentEvidence(evidence, "billing.default", service);

      await module.refreshActiveContracts();
      const plan = await planUserContractApproval(module, {
        format: "trellis.contract.v1",
        id: "console@v1",
        displayName: "Console",
        description: "Browser app",
        kind: "app",
        uses: {
          billing: {
            contract: "billing@v1",
            operations: { call: ["Refund"] },
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
        [service.digest],
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
        billing: {
          contract: "billing@v1",
          operations: { call: ["Billing.Missing"] },
        },
      },
    } satisfies TrellisContractV1;

    await assertRejects(
      () => module.installServiceContract(consumer),
      Error,
      "inactive contract 'billing@v1'",
    );

    assertEquals(await contractStorage.listPage({ limit: 10 }), []);
  });
});

Deno.test("contracts runtime validates uses against active contracts", async () => {
  await withContractsModule(async (
    module,
    contractStorage,
    serviceDeploymentStorage,
    evidence,
    envelopes,
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
        billing: {
          contract: "billing@v1",
          operations: { call: ["Billing.Missing"] },
        },
      },
    } satisfies TrellisContractV1;

    await assertRejects(
      () => module.installServiceContract(badConsumer),
      Error,
      "inactive contract 'billing@v1'",
    );

    await serviceDeploymentStorage.put(
      testServiceDeployment("billing.default", ["Billing"]),
    );
    await putDeploymentEnvelope(envelopes, "billing.default", "service", [
      billing.id,
    ]);
    await putDeploymentEvidence(evidence, "billing.default", billing);

    await assertRejects(
      () => module.installServiceContract(badConsumer),
      Error,
      "missing operation 'Billing.Missing'",
    );

    const goodConsumer = {
      ...badConsumer,
      uses: {
        billing: {
          contract: "billing@v1",
          operations: { call: ["Refund"] },
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
      "inactive contract 'billing@v1'",
    );

    assertEquals(await contractStorage.listPage({ limit: 10 }), []);
  });
});

Deno.test("contracts runtime allows grouped optional uses to be absent", async () => {
  await withContractsModule(
    async (module, contractStorage, deployments, evidence, envelopes) => {
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
      await deployments.put(
        testServiceDeployment("portal.default", ["Portal"]),
      );
      await putDeploymentEnvelope(envelopes, "portal.default", "service", [
        portal.id,
      ]);
      await putDeploymentEvidence(evidence, "portal.default", portal);

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
        [portal.digest],
      );
    },
  );
});

Deno.test("contracts runtime can refresh removal catalogs with existing inactive uses", async () => {
  await withContractsModule(
    async (
      module,
      _contractStorage,
      serviceDeployments,
      evidence,
      envelopes,
    ) => {
      const billing = await module.installServiceContract(
        makeOperationContract("billing@v1", "operations.v1.Billing.Refund"),
      );
      await serviceDeployments.put(
        testServiceDeployment("billing.default", ["Billing"]),
      );
      await putDeploymentEnvelope(envelopes, "billing.default", "service", [
        billing.id,
      ]);
      await putDeploymentEvidence(evidence, "billing.default", billing);

      const portal = await module.installServiceContract({
        format: "trellis.contract.v1",
        id: "portal@v1",
        displayName: "Portal",
        description: "Calls billing operations.",
        kind: "service",
        uses: {
          billing: {
            contract: "billing@v1",
            operations: { call: ["Refund"] },
          },
        },
      });
      await serviceDeployments.put(
        testServiceDeployment("portal.default", ["Portal"]),
      );
      await putDeploymentEnvelope(envelopes, "portal.default", "service", [
        portal.id,
      ]);
      await putDeploymentEvidence(evidence, "portal.default", portal);

      await module.refreshActiveContracts();

      assertEquals(
        (await module.getActiveCatalog()).contracts.map((entry) =>
          entry.digest
        ),
        [billing.digest, portal.digest],
      );
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

Deno.test("contracts runtime refresh fails closed for invalid deployment evidence", async () => {
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
    const deploymentContractEvidenceStorage =
      new SqlDeploymentContractEvidenceRepository(storage.db);
    const deploymentEnvelopeStorage = new SqlDeploymentEnvelopeRepository(
      storage.db,
    );
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      deploymentContractEvidenceStorage,
      deploymentEnvelopeStorage,
      serviceInstanceStorage,
      serviceDeploymentStorage,
      deviceDeploymentStorage,
      deviceInstanceStorage: new SqlDeviceInstanceRepository(storage.db),
    });
    await serviceDeploymentStorage.put(
      testServiceDeployment("service.default", ["Service"]),
    );
    await putDeploymentEnvelope(
      deploymentEnvelopeStorage,
      "service.default",
      "service",
      ["service@v1"],
    );
    await deploymentContractEvidenceStorage.put({
      deploymentId: "service.default",
      contractId: "service@v1",
      contractDigest: "missing-digest",
      contract: {},
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    });
    await serviceInstanceStorage.put({
      instanceId: "svc_1",
      deploymentId: "service.default",
      instanceKey: "session-key",
      disabled: false,
      currentContractId: "service@v1",
      currentContractDigest: "missing-digest",
      capabilities: ["service"],
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    await assertRejects(
      () => module.refreshActiveContracts(),
      Error,
      "Unknown active contract digest 'missing-digest'",
    );
    await assertRejects(
      () => module.getActiveCatalog(),
      Error,
      "Unknown active contract digest 'missing-digest'",
    );
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});

Deno.test("contracts runtime refresh fails closed when an active contract cannot hydrate", async () => {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-catalog-runtime-bad-active-",
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
    const deploymentContractEvidenceStorage =
      new SqlDeploymentContractEvidenceRepository(storage.db);
    const deploymentEnvelopeStorage = new SqlDeploymentEnvelopeRepository(
      storage.db,
    );
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      deploymentContractEvidenceStorage,
      deploymentEnvelopeStorage,
      serviceInstanceStorage,
      serviceDeploymentStorage,
      deviceDeploymentStorage: new SqlDeviceDeploymentRepository(storage.db),
      deviceInstanceStorage: new SqlDeviceInstanceRepository(storage.db),
    });
    await contractStorage.put({
      digest: "bad-digest",
      id: "service@v1",
      displayName: "Service",
      description: "Bad stored contract",
      installedAt: new Date(),
      contract: "{not json",
    });
    await serviceDeploymentStorage.put(
      testServiceDeployment("service.default", ["Service"]),
    );
    await putDeploymentEnvelope(
      deploymentEnvelopeStorage,
      "service.default",
      "service",
      ["service@v1"],
    );
    await deploymentContractEvidenceStorage.put({
      deploymentId: "service.default",
      contractId: "service@v1",
      contractDigest: "bad-digest",
      contract: {},
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    });
    await serviceInstanceStorage.put({
      instanceId: "svc_1",
      deploymentId: "service.default",
      instanceKey: "session-key",
      disabled: false,
      currentContractId: "service@v1",
      currentContractDigest: "bad-digest",
      capabilities: ["service"],
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    await assertRejects(
      () => module.refreshActiveContracts(),
      Error,
      "Failed to load active contract 'bad-digest'",
    );
    await assertRejects(
      () => module.getActiveCatalog(),
      Error,
      "Failed to load active contract 'bad-digest'",
    );
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});

Deno.test("contracts runtime refresh fails closed before activating divergent compatible digests", async () => {
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
    const deploymentContractEvidenceStorage =
      new SqlDeploymentContractEvidenceRepository(storage.db);
    const deploymentEnvelopeStorage = new SqlDeploymentEnvelopeRepository(
      storage.db,
    );
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      deploymentContractEvidenceStorage,
      deploymentEnvelopeStorage,
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
    await putDeploymentEnvelope(
      deploymentEnvelopeStorage,
      "service.default",
      "service",
      ["billing@v1"],
    );
    await putDeploymentEvidence(
      deploymentContractEvidenceStorage,
      "service.default",
      firstInstalled,
    );
    await putDeploymentEvidence(
      deploymentContractEvidenceStorage,
      "service.default",
      secondInstalled,
    );
    await serviceInstanceStorage.put({
      instanceId: "svc_1",
      deploymentId: "service.default",
      instanceKey: "session-key-1",
      disabled: false,
      currentContractId: "billing@v1",
      currentContractDigest: firstInstalled.digest,
      capabilities: ["service"],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await serviceInstanceStorage.put({
      instanceId: "svc_2",
      deploymentId: "service.default",
      instanceKey: "session-key-2",
      disabled: false,
      currentContractId: "billing@v1",
      currentContractDigest: secondInstalled.digest,
      capabilities: ["service"],
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    await assertRejects(
      () => module.refreshActiveContracts(),
      Error,
      "different capabilities",
    );
    await assertRejects(
      () => module.getActiveCatalog(),
      Error,
      "different capabilities",
    );
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
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
    const deploymentContractEvidenceStorage =
      new SqlDeploymentContractEvidenceRepository(storage.db);
    const deploymentEnvelopeStorage = new SqlDeploymentEnvelopeRepository(
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
      deploymentContractEvidenceStorage,
      deploymentEnvelopeStorage,
      serviceInstanceStorage,
      serviceDeploymentStorage,
      deviceDeploymentStorage: new SqlDeviceDeploymentRepository(storage.db),
      deviceInstanceStorage: new SqlDeviceInstanceRepository(storage.db),
    });
    const old = makeOperationContract(
      "trellis.builtin@v1",
      "operations.v1.TrellisBuiltin.Refresh",
    );
    old.operations!.Refund!.capabilities = {
      call: ["trellis.builtin.refresh"],
    };
    const oldInstalled = await module.installServiceContract(old);

    await serviceDeploymentStorage.put(
      testServiceDeployment("trellis.builtin", ["TrellisBuiltin"]),
    );
    await putDeploymentEvidence(
      deploymentContractEvidenceStorage,
      "trellis.builtin",
      oldInstalled,
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
      deploymentEnvelopeStorage: new SqlDeploymentEnvelopeRepository(
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
              currentContractId: "billing@v1",
              currentContractDigest: firstInstalled.digest,
              capabilities: ["service"],
              createdAt: "2026-01-01T00:00:00.000Z",
            },
            {
              instanceId: "svc_2",
              deploymentId: "service.default",
              instanceKey: "session-key-2",
              disabled: false,
              currentContractId: "billing@v1",
              currentContractDigest: secondInstalled.digest,
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

Deno.test("contracts runtime refresh rejects active uses dependencies without mutating active permission state", async () => {
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
    const deploymentContractEvidenceStorage =
      new SqlDeploymentContractEvidenceRepository(storage.db);
    const deploymentEnvelopeStorage = new SqlDeploymentEnvelopeRepository(
      storage.db,
    );
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      deploymentContractEvidenceStorage,
      deploymentEnvelopeStorage,
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
    await putDeploymentEnvelope(
      deploymentEnvelopeStorage,
      "billing.default",
      "service",
      [billing.id],
    );
    await putDeploymentEvidence(
      deploymentContractEvidenceStorage,
      "billing.default",
      billing,
    );
    await serviceInstanceStorage.put({
      instanceId: "svc_billing",
      deploymentId: "billing.default",
      instanceKey: "billing-session-key",
      disabled: false,
      currentContractId: billing.id,
      currentContractDigest: billing.digest,
      capabilities: ["service"],
      createdAt: now,
    });
    const portal = await module.installServiceContract(
      {
        format: "trellis.contract.v1",
        id: "portal@v1",
        displayName: "Portal",
        description: "Calls billing operations.",
        kind: "service",
        uses: {
          billing: {
            contract: "billing@v1",
            operations: { call: ["Refund"] },
          },
        },
      } satisfies TrellisContractV1,
    );
    await module.refreshActiveContracts();

    await serviceDeploymentStorage.put(
      testServiceDeployment("billing.default", ["Billing"], true),
    );
    await putDeploymentEnvelope(
      deploymentEnvelopeStorage,
      "billing.default",
      "service",
      [billing.id],
      true,
    );
    await serviceDeploymentStorage.put(
      testServiceDeployment("portal.default", ["Portal"]),
    );
    await putDeploymentEnvelope(
      deploymentEnvelopeStorage,
      "portal.default",
      "service",
      [portal.id],
    );
    await putDeploymentEvidence(
      deploymentContractEvidenceStorage,
      "portal.default",
      portal,
    );
    await serviceInstanceStorage.put({
      instanceId: "svc_portal",
      deploymentId: "portal.default",
      instanceKey: "portal-session-key",
      disabled: false,
      currentContractId: portal.id,
      currentContractDigest: portal.digest,
      capabilities: ["service"],
      createdAt: now,
    });

    await assertRejects(
      () => module.refreshActiveContracts(),
      Error,
      "inactive contract 'billing@v1'",
    );
    await assertRejects(
      () => module.getActiveCatalog(),
      Error,
      "inactive contract 'billing@v1'",
    );
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});

Deno.test("contracts runtime fails closed when persisted contract context cannot be loaded", async () => {
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
    const deploymentEnvelopeStorage = new SqlDeploymentEnvelopeRepository(
      storage.db,
    );
    const deploymentContractEvidenceStorage =
      new SqlDeploymentContractEvidenceRepository(storage.db);
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      deploymentContractEvidenceStorage,
      deploymentEnvelopeStorage,
      serviceInstanceStorage: new SqlServiceInstanceRepository(storage.db),
      serviceDeploymentStorage,
      deviceDeploymentStorage: new SqlDeviceDeploymentRepository(storage.db),
      deviceInstanceStorage: new SqlDeviceInstanceRepository(storage.db),
    });
    const activeContract = makeOperationContract(
      "active@v1",
      "operations.v1.Active.Run",
    );
    const activeDigest = digestContractManifest(activeContract);
    await serviceDeploymentStorage.put(
      testServiceDeployment("active.default", ["Active"]),
    );
    await putDeploymentEnvelope(
      deploymentEnvelopeStorage,
      "active.default",
      "service",
      [activeContract.id],
    );
    await deploymentContractEvidenceStorage.put({
      deploymentId: "active.default",
      contractId: activeContract.id,
      contractDigest: activeDigest,
      contract: contractEvidenceJson(activeContract),
      firstSeenAt: TEST_NOW,
      lastSeenAt: TEST_NOW,
    });

    await assertRejects(
      () =>
        module.installServiceContract(
          makeOperationContract("billing@v1", "operations.v1.Billing.Refund"),
        ),
      Error,
      "contract lookup failed",
    );
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
      deploymentEnvelopeStorage: new SqlDeploymentEnvelopeRepository(
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
      trellisId: "github.user-session",
      origin: "github",
      id: "user-session",
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
      deploymentEnvelopeStorage: new SqlDeploymentEnvelopeRepository(
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

Deno.test("contracts runtime activates service deployment envelope evidence without active instances", async () => {
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
    const deploymentContractEvidenceStorage =
      new SqlDeploymentContractEvidenceRepository(storage.db);
    const deploymentEnvelopeStorage = new SqlDeploymentEnvelopeRepository(
      storage.db,
    );
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      deploymentContractEvidenceStorage,
      deploymentEnvelopeStorage,
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
    await putDeploymentEnvelope(
      deploymentEnvelopeStorage,
      "service.default",
      "service",
      [installed.id],
    );
    await putDeploymentEvidence(
      deploymentContractEvidenceStorage,
      "service.default",
      installed,
    );

    await module.refreshActiveContracts();

    assertEquals(
      (await module.getActiveCatalog()).contracts.map((entry) => entry.digest),
      [installed.digest],
    );
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});

Deno.test("contracts runtime fails closed for evidence-only active contract manifests", async () => {
  await withContractsModule(
    async (
      module,
      contractStorage,
      serviceDeploymentStorage,
      deploymentContractEvidenceStorage,
      deploymentEnvelopeStorage,
    ) => {
      const validated = await module.validateContract(
        makeOperationContract("evidence-only@v1", "operations.v1.Evidence.Run"),
      );
      await serviceDeploymentStorage.put(
        testServiceDeployment("service.evidence", ["Evidence"]),
      );
      await putDeploymentEnvelope(
        deploymentEnvelopeStorage,
        "service.evidence",
        "service",
        [validated.contract.id],
      );
      await deploymentContractEvidenceStorage.put({
        deploymentId: "service.evidence",
        contractId: validated.contract.id,
        contractDigest: validated.digest,
        contract: contractEvidenceJson(validated.contract),
        firstSeenAt: TEST_NOW,
        lastSeenAt: TEST_NOW,
      });

      await assertRejects(
        () => module.refreshActiveContracts(),
        Error,
        `Unknown active contract digest '${validated.digest}'`,
      );

      assertEquals(await contractStorage.listPage({ limit: 10 }), []);
      await assertRejects(
        () => module.getActiveCatalog(),
        Error,
        `Unknown active contract digest '${validated.digest}'`,
      );
    },
  );
});

Deno.test("contracts runtime activates enabled service and device deployment evidence", async () => {
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
    const deploymentContractEvidenceStorage =
      new SqlDeploymentContractEvidenceRepository(storage.db);
    const deploymentEnvelopeStorage = new SqlDeploymentEnvelopeRepository(
      storage.db,
    );
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      deploymentContractEvidenceStorage,
      deploymentEnvelopeStorage,
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
      currentContractId: service.id,
      currentContractDigest: service.digest,
      capabilities: ["service"],
      createdAt: now,
    });
    await serviceDeploymentStorage.put(
      testServiceDeployment("service.default", ["Service"]),
    );
    await putDeploymentEnvelope(
      deploymentEnvelopeStorage,
      "service.default",
      "service",
      [service.id],
    );
    await deviceDeploymentStorage.put(testDeviceDeployment("device.default"));
    await putDeploymentEnvelope(
      deploymentEnvelopeStorage,
      "device.default",
      "device",
      [device.id],
    );
    await putDeploymentEvidence(
      deploymentContractEvidenceStorage,
      "service.default",
      service,
    );
    await putDeploymentEvidence(
      deploymentContractEvidenceStorage,
      "device.default",
      device,
    );
    await module.refreshActiveContracts();

    assertEquals(
      (await module.getActiveCatalog()).contracts.map((entry) => entry.digest)
        .sort(),
      [device.digest, service.digest].sort(),
    );
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});

Deno.test("contracts runtime excludes deployment evidence for disabled parent deployments", async () => {
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
    const deploymentContractEvidenceStorage =
      new SqlDeploymentContractEvidenceRepository(storage.db);
    const deploymentEnvelopeStorage = new SqlDeploymentEnvelopeRepository(
      storage.db,
    );
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      deploymentContractEvidenceStorage,
      deploymentEnvelopeStorage,
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
    await putDeploymentEnvelope(
      deploymentEnvelopeStorage,
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
      currentContractId: service.id,
      currentContractDigest: service.digest,
      capabilities: ["service"],
      createdAt: now,
    });
    await deviceDeploymentStorage.put(
      testDeviceDeployment("device.disabled", true),
    );
    await putDeploymentEnvelope(
      deploymentEnvelopeStorage,
      "device.disabled",
      "device",
      [device.id],
      true,
    );
    await putDeploymentEvidence(
      deploymentContractEvidenceStorage,
      "service.disabled",
      service,
    );
    await putDeploymentEvidence(
      deploymentContractEvidenceStorage,
      "device.disabled",
      device,
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
