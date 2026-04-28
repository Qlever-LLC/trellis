import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { assertEquals, assertRejects } from "@std/assert";
import { ContractStore } from "../../catalog/store.ts";
import { planUserContractApproval } from "./plan.ts";

Deno.test("planUserContractApproval derives exact app capabilities and subjects", async () => {
  const dependency: TrellisContractV1 = {
    format: "trellis.contract.v1",
    id: "example.auth@v1",
    displayName: "Example Auth",
    description: "Auth API",
    kind: "service",
    schemas: {
      EmptyInput: { type: "object" },
      EmptyOutput: { type: "object" },
      DownloadRequest: { type: "object" },
      DownloadResponse: { type: "object" },
      AuthConnectEvent: { type: "object" },
      EvidenceUploadRequest: {
        type: "object",
        properties: {
          key: { type: "string" },
          contentType: { type: "string" },
        },
        required: ["key", "contentType"],
      },
      EvidenceUploadResponse: { type: "object" },
    },
    rpc: {
      "Auth.Me": {
        version: "v1",
        subject: "rpc.v1.example.Auth.Me",
        input: { schema: "EmptyInput" },
        output: { schema: "EmptyOutput" },
        capabilities: { call: ["users:read"] },
      },
      "Evidence.Download": {
        version: "v1",
        subject: "rpc.v1.example.Evidence.Download",
        input: { schema: "DownloadRequest" },
        output: { schema: "DownloadResponse" },
        capabilities: { call: ["evidence:read"] },
        transfer: { direction: "receive" },
      },
    },
    events: {
      "Auth.Connect": {
        version: "v1",
        subject: "events.v1.example.Auth.Connect",
        event: { schema: "AuthConnectEvent" },
        capabilities: { publish: ["audit:write"], subscribe: ["audit:read"] },
      },
    },
    operations: {
      "Evidence.Upload": {
        version: "v1",
        subject: "operations.v1.example.Evidence.Upload",
        input: { schema: "EvidenceUploadRequest" },
        output: { schema: "EvidenceUploadResponse" },
        capabilities: { call: ["evidence:write"] },
        transfer: {
          direction: "send",
          store: "uploads",
          key: "/key",
          contentType: "/contentType",
        },
      },
    },
  };

  const store = new ContractStore([{
    digest: "dep-digest",
    contract: dependency,
  }]);

  const plan = await planUserContractApproval(store, {
    format: "trellis.contract.v1",
    id: "example.console@v1",
    displayName: "Example Console",
    description: "Browser app",
    kind: "app",
    uses: {
      auth: {
        contract: "example.auth@v1",
        rpc: { call: ["Auth.Me", "Evidence.Download"] },
        operations: { call: ["Evidence.Upload"] },
        events: { subscribe: ["Auth.Connect"] },
      },
    },
  });

  assertEquals(plan.approval.contractId, "example.console@v1");
  assertEquals(plan.approval.capabilities, [
    "audit:read",
    "evidence:read",
    "evidence:write",
    "users:read",
  ]);
  assertEquals(plan.publishSubjects, [
    "operations.v1.example.Evidence.Upload",
    "operations.v1.example.Evidence.Upload.control",
    "rpc.v1.example.Auth.Me",
    "rpc.v1.example.Evidence.Download",
    "transfer.v1.upload.*.*",
  ]);
  assertEquals(plan.subscribeSubjects, [
    "events.v1.example.Auth.Connect",
    "transfer.v1.download.*.*",
  ]);
});

Deno.test("planUserContractApproval includes operation read and declared cancel capabilities", async () => {
  const dependency: TrellisContractV1 = {
    format: "trellis.contract.v1",
    id: "example.jobs@v1",
    displayName: "Example Jobs",
    description: "Job API",
    kind: "service",
    schemas: {
      Empty: { type: "object" },
    },
    operations: {
      "Jobs.Run": {
        version: "v1",
        subject: "operations.v1.example.Jobs.Run",
        input: { schema: "Empty" },
        output: { schema: "Empty" },
        cancel: true,
        capabilities: {
          call: ["jobs:write"],
          read: ["jobs:read"],
          cancel: ["jobs:cancel"],
        },
      },
    },
  };

  const store = new ContractStore([{
    digest: "dep-digest",
    contract: dependency,
  }]);

  const plan = await planUserContractApproval(store, {
    format: "trellis.contract.v1",
    id: "example.console@v1",
    displayName: "Example Console",
    description: "Browser app",
    kind: "app",
    uses: {
      jobs: {
        contract: "example.jobs@v1",
        operations: { call: ["Jobs.Run"] },
      },
    },
  });

  assertEquals(plan.approval.capabilities, [
    "jobs:cancel",
    "jobs:read",
    "jobs:write",
  ]);
  assertEquals(plan.publishSubjects, [
    "operations.v1.example.Jobs.Run",
    "operations.v1.example.Jobs.Run.control",
  ]);
});

Deno.test("planUserContractApproval rejects app contracts with raw subjects", async () => {
  const store = new ContractStore();

  await assertRejects(
    () =>
      planUserContractApproval(store, {
        format: "trellis.contract.v1",
        id: "example.console@v1",
        displayName: "Example Console",
        description: "Browser app",
        kind: "app",
        subjects: {
          Audit: { subject: "nats.example.audit" },
        },
      }),
    Error,
    "Contract subjects are not supported in v1",
  );
});

Deno.test("planUserContractApproval rejects app contracts with raw subject uses", async () => {
  const store = new ContractStore();

  await assertRejects(
    () =>
      planUserContractApproval(store, {
        format: "trellis.contract.v1",
        id: "example.console@v1",
        displayName: "Example Console",
        description: "Browser app",
        kind: "app",
        uses: {
          audit: {
            contract: "example.audit@v1",
            subjects: { subscribe: ["Audit"] },
          },
        },
      }),
    Error,
    "Contract uses 'audit' declares unsupported subjects",
  );
});

Deno.test("planUserContractApproval maps explicit transfer declarations by direction", async () => {
  const dependency: TrellisContractV1 = {
    format: "trellis.contract.v1",
    id: "example.files@v1",
    displayName: "Example Files",
    description: "File API",
    kind: "service",
    schemas: {
      Empty: { type: "object" },
    },
    rpc: {
      Download: {
        version: "v1",
        subject: "rpc.v1.example.files.Download",
        input: { schema: "Empty" },
        output: { schema: "Empty" },
        transfer: { direction: "receive" },
      },
    },
    operations: {
      Upload: {
        version: "v1",
        subject: "operations.v1.example.files.Upload",
        input: { schema: "Empty" },
        output: { schema: "Empty" },
        transfer: { direction: "send", store: "uploads", key: "/key" },
      },
    },
  };

  const store = new ContractStore([{
    digest: "dep-digest",
    contract: dependency,
  }]);
  const plan = await planUserContractApproval(store, {
    format: "trellis.contract.v1",
    id: "example.console@v1",
    displayName: "Example Console",
    description: "Browser app",
    kind: "app",
    uses: {
      files: {
        contract: "example.files@v1",
        rpc: { call: ["Download"] },
        operations: { call: ["Upload"] },
      },
    },
  });

  assertEquals(plan.publishSubjects.includes("transfer.v1.upload.*.*"), true);
  assertEquals(
    plan.publishSubjects.includes("transfer.v1.download.*.*"),
    false,
  );
  assertEquals(
    plan.subscribeSubjects.includes("transfer.v1.download.*.*"),
    true,
  );
  assertEquals(
    plan.subscribeSubjects.includes("transfer.v1.upload.*.*"),
    false,
  );
});

Deno.test("planUserContractApproval rejects app contracts with inactive dependencies", async () => {
  const store = new ContractStore();

  await assertRejects(
    () =>
      planUserContractApproval(store, {
        format: "trellis.contract.v1",
        id: "example.console@v1",
        displayName: "Example Console",
        description: "Browser app",
        kind: "app",
        uses: {
          auth: {
            contract: "missing.auth@v1",
            rpc: { call: ["Auth.Me"] },
          },
        },
      }),
    Error,
    "Dependency 'auth' references inactive contract 'missing.auth@v1'",
  );
});

Deno.test("planUserContractApproval rejects agent contracts with inactive dependencies", async () => {
  const store = new ContractStore();

  await assertRejects(
    () =>
      planUserContractApproval(store, {
        format: "trellis.contract.v1",
        id: "example.cli@v1",
        displayName: "Example CLI",
        description: "Agent",
        kind: "agent",
        uses: {
          jobs: {
            contract: "missing.jobs@v1",
            operations: { call: ["Jobs.Run"] },
          },
        },
      }),
    Error,
    "Dependency 'jobs' references inactive contract 'missing.jobs@v1'",
  );
});

Deno.test("planUserContractApproval rejects inactive dependency surfaces even when known", async () => {
  const dependency: TrellisContractV1 = {
    format: "trellis.contract.v1",
    id: "example.auth@v1",
    displayName: "Example Auth",
    description: "Auth API",
    kind: "service",
    schemas: {
      EmptyInput: { type: "object" },
      EmptyOutput: { type: "object" },
    },
    rpc: {
      "Auth.Me": {
        version: "v1",
        subject: "rpc.v1.example.Auth.Me",
        input: { schema: "EmptyInput" },
        output: { schema: "EmptyOutput" },
      },
    },
  };

  const store = new ContractStore();
  store.add("dep-digest", dependency);

  await assertRejects(
    () =>
      planUserContractApproval(store, {
        format: "trellis.contract.v1",
        id: "example.console@v1",
        displayName: "Example Console",
        description: "Browser app",
        kind: "app",
        uses: {
          auth: {
            contract: "example.auth@v1",
            rpc: { call: ["Auth.Me"] },
          },
        },
      }),
    Error,
    "Dependency 'auth' references inactive contract 'example.auth@v1'",
  );
});

Deno.test("planUserContractApproval still rejects invalid active dependencies", async () => {
  const dependency: TrellisContractV1 = {
    format: "trellis.contract.v1",
    id: "example.auth@v1",
    displayName: "Example Auth",
    description: "Auth API",
    kind: "service",
    schemas: {
      EmptyInput: { type: "object" },
      EmptyOutput: { type: "object" },
    },
    rpc: {
      "Auth.Me": {
        version: "v1",
        subject: "rpc.v1.example.Auth.Me",
        input: { schema: "EmptyInput" },
        output: { schema: "EmptyOutput" },
      },
    },
  };

  const store = new ContractStore([{
    digest: "dep-digest",
    contract: dependency,
  }]);

  await assertRejects(
    () =>
      planUserContractApproval(store, {
        format: "trellis.contract.v1",
        id: "example.console@v1",
        displayName: "Example Console",
        description: "Browser app",
        kind: "app",
        uses: {
          auth: {
            contract: "example.auth@v1",
            rpc: { call: ["Auth.Missing"] },
          },
        },
      }),
    Error,
    "Dependency 'auth' references missing RPC 'Auth.Missing' on 'example.auth@v1'",
  );
});
