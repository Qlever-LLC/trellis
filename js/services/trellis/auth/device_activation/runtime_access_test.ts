import { assertEquals } from "@std/assert";
import type {
  ContractOperation,
  TrellisContractV1,
} from "@qlever-llc/trellis/contracts";

import type { ContractRecord } from "../../catalog/schemas.ts";
import type { ContractsModule } from "../../catalog/runtime.ts";
import type { EnvelopeBoundary } from "../schemas.ts";

import { deriveDeviceRuntimeAccess } from "./runtime_access.ts";

function makeContractRecord(digest: string): ContractRecord {
  return {
    digest,
    id: "acme.reader@v1",
    displayName: "Reader",
    description: "Reader device contract",
    installedAt: new Date(),
    contract: JSON.stringify({ id: "acme.reader@v1" }),
    analysis: {
      namespaces: [],
      rpc: {
        methods: [{
          key: "Reader.Ping",
          subject: "rpc.v1.Reader.Ping",
          wildcardSubject: "rpc.v1.Reader.Ping",
          callerCapabilities: ["reader.call"],
        }],
      },
      operations: {
        operations: [],
        control: [],
      },
      events: {
        events: [],
      },
      nats: {
        publish: [{
          kind: "rpc",
          subject: "rpc.v1.Reader.Ping",
          wildcardSubject: "rpc.v1.Reader.Ping",
          requiredCapabilities: ["reader.call"],
        }],
        subscribe: [{
          kind: "rpc",
          subject: "rpc.v1.Reader.Ping",
          wildcardSubject: "rpc.v1.Reader.Ping",
          requiredCapabilities: ["reader.call"],
        }],
      },
      resources: {
        kv: [],
        store: [],
        jobs: [],
      },
    },
  };
}

function makeUsesContractRecord(): ContractRecord {
  return {
    ...makeContractRecord("digest-uses"),
    digest: "digest-uses",
    contract: JSON.stringify({
      id: "acme.reader@v1",
      displayName: "Reader",
      description: "Reader device contract",
      kind: "device",
      uses: {
        auth: {
          contract: "trellis.auth@v1",
          rpc: { call: ["Auth.Sessions.Me"] },
        },
        billing: {
          contract: "billing@v1",
          operations: { call: ["Billing.Refund"] },
        },
      },
    }),
  };
}

function createDependencyContracts(
  billingOperation: ContractOperation,
): Pick<ContractsModule, "getActiveEntries"> {
  const authContract: TrellisContractV1 = {
    format: "trellis.contract.v1",
    id: "trellis.auth@v1",
    displayName: "Auth",
    description: "Auth API",
    kind: "service",
    rpc: {
      "Auth.Sessions.Me": {
        subject: "rpc.v1.Auth.Sessions.Me",
        version: "v1",
        transfer: { direction: "receive" },
        capabilities: { call: [] },
        input: { schema: "object" },
        output: { schema: "object" },
      },
    },
  };
  const billingContract: TrellisContractV1 = {
    format: "trellis.contract.v1",
    id: "billing@v1",
    displayName: "Billing",
    description: "Billing API",
    kind: "service",
    operations: {
      "Billing.Refund": billingOperation,
    },
  };
  return {
    getActiveEntries: async () => [
      { digest: "digest-auth", contract: authContract },
      { digest: "digest-billing", contract: billingContract },
    ],
  };
}

Deno.test("deriveDeviceRuntimeAccess preserves the caller-selected digest", async () => {
  const access = await deriveDeviceRuntimeAccess(
    makeContractRecord("digest-b"),
  );
  assertEquals(access.ok, true);
  if (!access.ok) return;

  assertEquals(access.value.contractDigest, "digest-b");
  assertEquals(access.value.contractId, "acme.reader@v1");
  assertEquals(access.value.capabilities, ["reader.call"]);
  assertEquals(
    access.value.publishSubjects.includes("transfer.v1.upload.*.*"),
    false,
  );
  assertEquals(
    access.value.publishSubjects.includes("transfer.v1.download.*.*"),
    false,
  );
  assertEquals(
    access.value.subscribeSubjects.includes("transfer.v1.download.*.*"),
    false,
  );
});

Deno.test("deriveDeviceRuntimeAccess includes publish subjects from contract uses", async () => {
  const contracts = createDependencyContracts({
    subject: "operations.v1.Billing.Refund",
    version: "v1",
    transfer: {
      direction: "send",
      store: "uploads",
      key: "/key",
    },
    capabilities: { call: ["billing.refund"] },
    input: { schema: "object" },
    output: { schema: "object" },
  });

  const access = await deriveDeviceRuntimeAccess(
    makeUsesContractRecord(),
    contracts,
  );
  assertEquals(access.ok, true);
  if (!access.ok) return;

  assertEquals(
    access.value.publishSubjects.includes("rpc.v1.Auth.Sessions.Me"),
    true,
  );
  assertEquals(
    access.value.publishSubjects.includes("operations.v1.Billing.Refund"),
    true,
  );
  assertEquals(
    access.value.publishSubjects.includes(
      "operations.v1.Billing.Refund.control",
    ),
    true,
  );
  assertEquals(
    access.value.publishSubjects.includes("transfer.v1.upload.*.*"),
    true,
  );
  assertEquals(
    access.value.publishSubjects.includes("transfer.v1.download.*.*"),
    true,
  );
  assertEquals(
    access.value.subscribeSubjects.includes("transfer.v1.download.*.*"),
    false,
  );
  assertEquals(access.value.capabilities.includes("billing.refund"), true);
});

Deno.test("deriveDeviceRuntimeAccess gates optional use subjects by deployment envelope", async () => {
  const contracts = createDependencyContracts({
    subject: "operations.v1.Billing.Refund",
    version: "v1",
    capabilities: { call: ["billing.refund"] },
    input: { schema: "object" },
    output: { schema: "object" },
  });
  const envelope: EnvelopeBoundary = {
    contracts: [{ contractId: "trellis.auth@v1", required: true }],
    surfaces: [{
      contractId: "trellis.auth@v1",
      kind: "rpc",
      name: "Auth.Sessions.Me",
      action: "call",
      required: true,
    }],
    capabilities: [],
    resources: [],
  };

  const access = await deriveDeviceRuntimeAccess(
    makeUsesContractRecord(),
    contracts,
    envelope,
  );
  assertEquals(access.ok, true);
  if (!access.ok) return;

  assertEquals(
    access.value.publishSubjects.includes("rpc.v1.Auth.Sessions.Me"),
    true,
  );
  assertEquals(
    access.value.publishSubjects.includes("operations.v1.Billing.Refund"),
    false,
  );
  assertEquals(access.value.capabilities.includes("billing.refund"), false);
});

Deno.test("deriveDeviceRuntimeAccess includes operation control when call capabilities satisfy read", async () => {
  const contracts = createDependencyContracts({
    subject: "operations.v1.Billing.Refund",
    version: "v1",
    capabilities: {
      call: ["billing.refund"],
      read: ["billing.refund"],
    },
    input: { schema: "object" },
    output: { schema: "object" },
  });

  const access = await deriveDeviceRuntimeAccess(
    makeUsesContractRecord(),
    contracts,
  );
  assertEquals(access.ok, true);
  if (!access.ok) return;

  assertEquals(
    access.value.publishSubjects.includes(
      "operations.v1.Billing.Refund.control",
    ),
    true,
  );
});

Deno.test("deriveDeviceRuntimeAccess includes operation control when cancel is enabled and granted", async () => {
  const contracts = createDependencyContracts({
    subject: "operations.v1.Billing.Refund",
    version: "v1",
    cancel: true,
    capabilities: {
      call: ["billing.cancel"],
      read: ["billing.read"],
      cancel: ["billing.cancel"],
    },
    input: { schema: "object" },
    output: { schema: "object" },
  });

  const access = await deriveDeviceRuntimeAccess(
    makeUsesContractRecord(),
    contracts,
  );
  assertEquals(access.ok, true);
  if (!access.ok) return;

  assertEquals(
    access.value.publishSubjects.includes(
      "operations.v1.Billing.Refund.control",
    ),
    true,
  );
});

Deno.test("deriveDeviceRuntimeAccess ignores cancel capabilities when cancel is disabled", async () => {
  const contracts = createDependencyContracts({
    subject: "operations.v1.Billing.Refund",
    version: "v1",
    capabilities: {
      call: ["billing.cancel"],
      read: ["billing.read"],
      cancel: ["billing.cancel"],
    },
    input: { schema: "object" },
    output: { schema: "object" },
  });

  const access = await deriveDeviceRuntimeAccess(
    makeUsesContractRecord(),
    contracts,
  );
  assertEquals(access.ok, true);
  if (!access.ok) return;

  assertEquals(
    access.value.publishSubjects.includes(
      "operations.v1.Billing.Refund.control",
    ),
    false,
  );
});
