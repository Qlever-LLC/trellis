import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { assertEquals, assertRejects } from "@std/assert";
import { createTestContracts } from "../../catalog/test_contracts.ts";
import { planUserContractApproval } from "./plan.ts";

Deno.test("planUserContractApproval derives exact app capabilities and subjects", async () => {
  const dependency: TrellisContractV1 = {
    format: "trellis.contract.v1",
    id: "example.auth@v1",
    displayName: "Example Auth",
    description: "Auth API",
    kind: "service",
    capabilities: {
      "users:read": {
        displayName: "Read users",
        description: "Read user profile data.",
      },
    },
    schemas: {
      EmptyInput: { type: "object" },
      EmptyOutput: { type: "object" },
      DownloadRequest: { type: "object" },
      DownloadResponse: { type: "object" },
      AuthConnectionsOpenedEvent: { type: "object" },
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
      "Auth.Sessions.Me": {
        version: "v1",
        subject: "rpc.v1.example.Auth.Sessions.Me",
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
      "Auth.Connections.Opened": {
        version: "v1",
        subject: "events.v1.example.Auth.Connections.Opened",
        event: { schema: "AuthConnectionsOpenedEvent" },
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
    feeds: {
      "Audit.Feed": {
        version: "v1",
        subject: "feeds.v1.example.Audit.Feed",
        input: { schema: "EmptyInput" },
        event: { schema: "AuthConnectionsOpenedEvent" },
        capabilities: { subscribe: ["audit:read"] },
      },
    },
  };

  const store = createTestContracts([{
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
      required: {
        auth: {
          contract: "example.auth@v1",
          rpc: { call: ["Auth.Sessions.Me", "Evidence.Download"] },
          operations: { call: ["Evidence.Upload"] },
          events: { subscribe: ["Auth.Connections.Opened"] },
          feeds: { subscribe: ["Audit.Feed"] },
        },
      },
    },
  });

  assertEquals(plan.approval.contractId, "example.console@v1");
  assertEquals(plan.approval.capabilities, {
    "audit:read": {
      displayName: "audit:read",
      description: "Requires audit:read.",
    },
    "evidence:read": {
      displayName: "evidence:read",
      description: "Requires evidence:read.",
    },
    "evidence:write": {
      displayName: "evidence:write",
      description: "Requires evidence:write.",
    },
    "users:read": {
      displayName: "Read users",
      description: "Read user profile data.",
    },
  });
  assertEquals(plan.publishSubjects, [
    "$JS.ACK.>",
    "$JS.API.CONSUMER.CREATE.trellis",
    "$JS.API.CONSUMER.CREATE.trellis.>",
    "$JS.API.CONSUMER.DURABLE.CREATE.trellis.>",
    "$JS.API.CONSUMER.INFO.trellis.>",
    "$JS.API.CONSUMER.MSG.NEXT.trellis.>",
    "$JS.API.INFO",
    "feeds.v1.example.Audit.Feed",
    "operations.v1.example.Evidence.Upload",
    "operations.v1.example.Evidence.Upload.control",
    "rpc.v1.example.Auth.Sessions.Me",
    "rpc.v1.example.Evidence.Download",
    "transfer.v1.download.*.*",
    "transfer.v1.upload.*.*",
  ]);
  assertEquals(plan.subscribeSubjects, [
    "events.v1.example.Auth.Connections.Opened",
  ]);
});

Deno.test("planUserContractApproval includes operation observe and declared cancel capabilities", async () => {
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
          observe: ["jobs:read"],
          cancel: ["jobs:cancel"],
        },
      },
    },
  };

  const store = createTestContracts([{
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
      required: {
        jobs: {
          contract: "example.jobs@v1",
          operations: { call: ["Jobs.Run"] },
        },
      },
    },
  });

  assertEquals(plan.approval.capabilities, {
    "jobs:cancel": {
      displayName: "jobs:cancel",
      description: "Requires jobs:cancel.",
    },
    "jobs:read": {
      displayName: "jobs:read",
      description: "Requires jobs:read.",
    },
    "jobs:write": {
      displayName: "jobs:write",
      description: "Requires jobs:write.",
    },
  });
  assertEquals(plan.publishSubjects, [
    "operations.v1.example.Jobs.Run",
    "operations.v1.example.Jobs.Run.control",
  ]);
});

Deno.test("planUserContractApproval rejects app contracts with raw subjects", async () => {
  const store = createTestContracts();

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
  const store = createTestContracts();

  await assertRejects(
    () =>
      planUserContractApproval(store, {
        format: "trellis.contract.v1",
        id: "example.console@v1",
        displayName: "Example Console",
        description: "Browser app",
        kind: "app",
        uses: {
          required: {
            audit: {
              contract: "example.audit@v1",
              subjects: { subscribe: ["Audit"] },
            },
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

  const store = createTestContracts([{
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
      required: {
        files: {
          contract: "example.files@v1",
          rpc: { call: ["Download"] },
          operations: { call: ["Upload"] },
        },
      },
    },
  });

  assertEquals(plan.publishSubjects.includes("transfer.v1.upload.*.*"), true);
  assertEquals(
    plan.publishSubjects.includes("transfer.v1.download.*.*"),
    true,
  );
  assertEquals(
    plan.subscribeSubjects.includes("transfer.v1.download.*.*"),
    false,
  );
  assertEquals(
    plan.subscribeSubjects.includes("transfer.v1.upload.*.*"),
    false,
  );
});

Deno.test("planUserContractApproval rejects app contracts with inactive dependencies", async () => {
  const store = createTestContracts();

  await assertRejects(
    () =>
      planUserContractApproval(store, {
        format: "trellis.contract.v1",
        id: "example.console@v1",
        displayName: "Example Console",
        description: "Browser app",
        kind: "app",
        uses: {
          required: {
            auth: {
              contract: "missing.auth@v1",
              rpc: { call: ["Auth.Sessions.Me"] },
            },
          },
        },
      }),
    Error,
    "Dependency 'auth' references inactive contract 'missing.auth@v1'",
  );
});

Deno.test("planUserContractApproval rejects agent contracts with inactive dependencies", async () => {
  const store = createTestContracts();

  await assertRejects(
    () =>
      planUserContractApproval(store, {
        format: "trellis.contract.v1",
        id: "example.cli@v1",
        displayName: "Example CLI",
        description: "Agent",
        kind: "agent",
        uses: {
          required: {
            jobs: {
              contract: "missing.jobs@v1",
              operations: { call: ["Jobs.Run"] },
            },
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
      "Auth.Sessions.Me": {
        version: "v1",
        subject: "rpc.v1.example.Auth.Sessions.Me",
        input: { schema: "EmptyInput" },
        output: { schema: "EmptyOutput" },
      },
    },
  };

  const store = createTestContracts();
  store.addKnownTestContract({ digest: "dep-digest", contract: dependency });

  await assertRejects(
    () =>
      planUserContractApproval(store, {
        format: "trellis.contract.v1",
        id: "example.console@v1",
        displayName: "Example Console",
        description: "Browser app",
        kind: "app",
        uses: {
          required: {
            auth: {
              contract: "example.auth@v1",
              rpc: { call: ["Auth.Sessions.Me"] },
            },
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
      "Auth.Sessions.Me": {
        version: "v1",
        subject: "rpc.v1.example.Auth.Sessions.Me",
        input: { schema: "EmptyInput" },
        output: { schema: "EmptyOutput" },
      },
    },
  };

  const store = createTestContracts([{
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
          required: {
            auth: {
              contract: "example.auth@v1",
              rpc: { call: ["Auth.Missing"] },
            },
          },
        },
      }),
    Error,
    "Dependency 'auth' references missing rpc 'Auth.Missing' on 'example.auth@v1'",
  );
});
