import { assertEquals, assertRejects } from "@std/assert";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";

import {
  SqlDeviceInstanceRepository,
  SqlServiceInstanceRepository,
  SqlServiceProfileRepository,
} from "../auth/storage.ts";
import {
  initializeTrellisStorageSchema,
  openTrellisStorageDb,
} from "../storage/db.ts";
import type { ContractsModule } from "./runtime.ts";
import { SqlContractStorageRepository } from "./storage.ts";

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
        serviceProfileStorage: new SqlServiceProfileRepository(storage.db),
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

Deno.test("contracts runtime preflights operation subject collisions before persistence", async () => {
  await withContractsModule(async (module, contractStorage) => {
    await module.installServiceContract(
      makeOperationContract("billing@v1", "operations.v1.Billing.Refund"),
    );

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
