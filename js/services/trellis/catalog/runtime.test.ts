import { assertEquals, assertRejects } from "@std/assert";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";

import {
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
import type { ContractsModule } from "./runtime.ts";
import type { ContractRecord } from "./schemas.ts";
import { SqlContractStorageRepository } from "./storage.ts";

class FailingListContractStorageRepository
  extends SqlContractStorageRepository {
  override async list(): Promise<ContractRecord[]> {
    throw new Error("contract list failed");
  }
}

async function withContractsModule(
  test: (
    module: ContractsModule,
    contractStorage: SqlContractStorageRepository,
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
    await test(
      createContractsModule({
        builtinContracts: [],
        contractStorage,
        serviceInstanceStorage: new SqlServiceInstanceRepository(storage.db),
        serviceDeploymentStorage: new SqlServiceDeploymentRepository(
          storage.db,
        ),
        deviceDeploymentStorage: new SqlDeviceDeploymentRepository(storage.db),
        deviceInstanceStorage: new SqlDeviceInstanceRepository(storage.db),
      }),
      contractStorage,
    );
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
}

function makeOperationContract(
  id: string,
  subject: string,
  version: `v${number}` = "v1",
): TrellisContractV1 {
  return {
    format: "trellis.contract.v1",
    id,
    displayName: id,
    description: `${id} test contract`,
    kind: "service",
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
  await withContractsModule(async (module, contractStorage) => {
    const installed = await module.installServiceContract(
      makeOperationContract("billing@v1", "operations.v1.Billing.Refund"),
    );
    module.contractStore.activateDigest(installed.digest);

    await assertRejects(
      async () => {
        await module.installServiceContract(
          makeOperationContract("other@v1", "operations.v1.Billing.Refund"),
        );
      },
      Error,
      "Operation subject 'operations.v1.Billing.Refund' already owned by",
    );

    assertEquals((await contractStorage.list()).map((entry) => entry.id), [
      "billing@v1",
    ]);
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

    assertEquals(await contractStorage.list(), []);
  });
});

Deno.test("contracts runtime rejects uses dependencies before persistence", async () => {
  await withContractsModule(async (module, contractStorage) => {
    const consumer = {
      format: "trellis.contract.v1",
      id: "portal@v1",
      displayName: "Portal",
      description: "Calls billing operations.",
      kind: "app",
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
      "unknown contract 'billing@v1'",
    );

    assertEquals(await contractStorage.list(), []);
  });
});

Deno.test("contracts runtime validates uses against known persisted contracts", async () => {
  await withContractsModule(async (module, contractStorage) => {
    await module.installServiceContract(
      makeOperationContract("billing@v1", "operations.v1.Billing.Refund"),
    );

    const badConsumer = {
      format: "trellis.contract.v1",
      id: "portal@v1",
      displayName: "Portal",
      description: "Calls billing operations.",
      kind: "app",
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
      (await contractStorage.list()).map((entry) => entry.id).sort(),
      [
        "billing@v1",
        "portal@v1",
      ],
    );
  });
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
    const contractStorage = new FailingListContractStorageRepository(
      storage.db,
    );
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      serviceInstanceStorage: new SqlServiceInstanceRepository(storage.db),
      serviceDeploymentStorage: new SqlServiceDeploymentRepository(storage.db),
      deviceDeploymentStorage: new SqlDeviceDeploymentRepository(storage.db),
      deviceInstanceStorage: new SqlDeviceInstanceRepository(storage.db),
    });

    await assertRejects(
      () =>
        module.installServiceContract(
          makeOperationContract("billing@v1", "operations.v1.Billing.Refund"),
        ),
      Error,
      "Failed to list installed contracts",
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
      serviceInstanceStorage,
      serviceDeploymentStorage,
      deviceDeploymentStorage,
      deviceInstanceStorage,
    });
    const installed = await module.installServiceContract(
      makeOperationContract("session-only@v1", "operations.v1.Session.Only"),
    );
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
      contractDigest: installed.digest,
      contractId: installed.id,
      contractDisplayName: installed.displayName,
      contractDescription: installed.description,
      delegatedCapabilities: [],
      delegatedPublishSubjects: [],
      delegatedSubscribeSubjects: [],
    });

    const refreshedModule = createContractsModule({
      builtinContracts: [],
      contractStorage,
      serviceInstanceStorage,
      serviceDeploymentStorage,
      deviceDeploymentStorage: new SqlDeviceDeploymentRepository(storage.db),
      deviceInstanceStorage,
    });
    await refreshedModule.refreshActiveContracts();

    assertEquals(
      refreshedModule.contractStore.getActiveCatalog().contracts,
      [],
    );
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});

Deno.test("contracts runtime does not activate service deployment allowed digests without active instances", async () => {
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
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      serviceInstanceStorage,
      serviceDeploymentStorage,
      deviceDeploymentStorage,
      deviceInstanceStorage,
    });
    const installed = await module.installServiceContract(
      makeOperationContract("service@v1", "operations.v1.Service.Run"),
    );
    await serviceDeploymentStorage.put({
      deploymentId: "service.default",
      namespaces: ["Service"],
      disabled: false,
      appliedContracts: [{
        contractId: installed.id,
        allowedDigests: [installed.digest],
      }],
    });

    await module.refreshActiveContracts();

    assertEquals(module.contractStore.getActiveCatalog().contracts, []);
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});

Deno.test("contracts runtime activates enabled service and activated device current digests", async () => {
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
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      serviceInstanceStorage,
      serviceDeploymentStorage,
      deviceDeploymentStorage,
      deviceInstanceStorage,
    });
    const service = await module.installServiceContract(
      makeOperationContract("service@v1", "operations.v1.Service.Run"),
    );
    const device = await module.installDeviceContract(
      makeOperationContract("device@v1", "operations.v1.Device.Run"),
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
    await serviceDeploymentStorage.put({
      deploymentId: "service.default",
      namespaces: ["Service"],
      disabled: false,
      appliedContracts: [{
        contractId: service.id,
        allowedDigests: [service.digest],
      }],
    });
    await deviceDeploymentStorage.put({
      deploymentId: "device.default",
      disabled: false,
      appliedContracts: [{
        contractId: device.id,
        allowedDigests: [device.digest],
      }],
    });
    await deviceInstanceStorage.put({
      instanceId: "dev_1",
      publicIdentityKey: "public-key",
      deploymentId: "device.default",
      state: "activated",
      currentContractId: device.id,
      currentContractDigest: device.digest,
      createdAt: now,
      activatedAt: now,
      revokedAt: null,
    });

    await module.refreshActiveContracts();

    assertEquals(
      module.contractStore.getActiveCatalog().contracts.map((entry) =>
        entry.digest
      ).sort(),
      [device.digest, service.digest].sort(),
    );
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});

Deno.test("contracts runtime excludes current digests for disabled parent deployments", async () => {
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
    const module = createContractsModule({
      builtinContracts: [],
      contractStorage,
      serviceInstanceStorage,
      serviceDeploymentStorage,
      deviceDeploymentStorage,
      deviceInstanceStorage,
    });
    const service = await module.installServiceContract(
      makeOperationContract("disabled-service@v1", "operations.v1.Service.Off"),
    );
    const device = await module.installDeviceContract(
      makeOperationContract("disabled-device@v1", "operations.v1.Device.Off"),
    );
    const now = "2026-01-01T00:00:00.000Z";
    await serviceDeploymentStorage.put({
      deploymentId: "service.disabled",
      namespaces: ["Service"],
      disabled: true,
      appliedContracts: [{
        contractId: service.id,
        allowedDigests: [service.digest],
      }],
    });
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
    await deviceDeploymentStorage.put({
      deploymentId: "device.disabled",
      disabled: true,
      appliedContracts: [{
        contractId: device.id,
        allowedDigests: [device.digest],
      }],
    });
    await deviceInstanceStorage.put({
      instanceId: "dev_disabled",
      publicIdentityKey: "public-key",
      deploymentId: "device.disabled",
      state: "activated",
      currentContractId: device.id,
      currentContractDigest: device.digest,
      createdAt: now,
      activatedAt: now,
      revokedAt: null,
    });

    await module.refreshActiveContracts();

    assertEquals(module.contractStore.getActiveCatalog().contracts, []);
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});
