import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { assertEquals, assertRejects } from "@std/assert";

import { createTestContracts } from "../catalog/test_contracts.ts";
import { analyzeContractProposal } from "./contract_proposal_analysis.ts";

const schemas = {
  Empty: { type: "object" },
};

function dependencyContract(): TrellisContractV1 {
  return {
    format: "trellis.contract.v1",
    id: "example.api@v1",
    displayName: "Example API",
    description: "Dependency API",
    kind: "service",
    capabilities: {
      "rpc:call": {
        displayName: "Call RPC",
        description: "Call RPC methods.",
      },
      "operation:call": {
        displayName: "Call operation",
        description: "Start operations.",
      },
      "operation:observe": {
        displayName: "Observe operation",
        description: "Observe operations.",
      },
      "operation:cancel": {
        displayName: "Cancel operation",
        description: "Cancel operations.",
      },
      "event:publish": {
        displayName: "Publish event",
        description: "Publish events.",
      },
      "event:subscribe": {
        displayName: "Subscribe event",
        description: "Subscribe to events.",
      },
      "feed:subscribe": {
        displayName: "Subscribe feed",
        description: "Subscribe to feeds.",
      },
    },
    schemas,
    rpc: {
      Ping: {
        version: "v1",
        subject: "rpc.v1.example.Ping",
        input: { schema: "Empty" },
        output: { schema: "Empty" },
        capabilities: { call: ["rpc:call"] },
        transfer: { direction: "receive" },
      },
    },
    operations: {
      Upload: {
        version: "v1",
        subject: "operations.v1.example.Upload",
        input: { schema: "Empty" },
        output: { schema: "Empty" },
        capabilities: {
          call: ["operation:call"],
          observe: ["operation:observe"],
          cancel: ["operation:cancel"],
        },
        cancel: true,
        transfer: { direction: "send", store: "uploads", key: "/key" },
      },
    },
    events: {
      Changed: {
        version: "v1",
        subject: "events.v1.example.Changed",
        event: { schema: "Empty" },
        capabilities: {
          publish: ["event:publish"],
          subscribe: ["event:subscribe"],
        },
      },
    },
    feeds: {
      Live: {
        version: "v1",
        subject: "feeds.v1.example.Live",
        input: { schema: "Empty" },
        event: { schema: "Empty" },
        capabilities: { subscribe: ["feed:subscribe"] },
      },
    },
  };
}

Deno.test("analyzeContractProposal derives required uses", async () => {
  const store = createTestContracts([{
    digest: "dep-digest",
    contract: dependencyContract(),
  }]);

  const analysis = await analyzeContractProposal(store, {
    format: "trellis.contract.v1",
    id: "example.app@v1",
    displayName: "Example App",
    description: "App contract",
    kind: "app",
    uses: {
      required: {
        api: {
          contract: "example.api@v1",
          rpc: { call: ["Ping"] },
          operations: { call: ["Upload"] },
          events: { publish: ["Changed"], subscribe: ["Changed"] },
          feeds: { subscribe: ["Live"] },
        },
      },
    },
  });

  assertEquals(analysis.contract.id, "example.app@v1");
  assertEquals(analysis.contract.kind, "app");
  assertEquals(analysis.required.contracts, [
    { contractId: "example.api@v1", required: true },
  ]);
  assertEquals(analysis.required.surfaces, [
    {
      contractId: "example.api@v1",
      kind: "event",
      name: "Changed",
      action: "publish",
      required: true,
    },
    {
      contractId: "example.api@v1",
      kind: "event",
      name: "Changed",
      action: "subscribe",
      required: true,
    },
    {
      contractId: "example.api@v1",
      kind: "feed",
      name: "Live",
      action: "subscribe",
      required: true,
    },
    {
      contractId: "example.api@v1",
      kind: "operation",
      name: "Upload",
      action: "call",
      required: true,
    },
    {
      contractId: "example.api@v1",
      kind: "operation",
      name: "Upload",
      action: "cancel",
      required: true,
    },
    {
      contractId: "example.api@v1",
      kind: "operation",
      name: "Upload",
      action: "observe",
      required: true,
    },
    {
      contractId: "example.api@v1",
      kind: "rpc",
      name: "Ping",
      action: "call",
      required: true,
    },
  ]);
  assertEquals(analysis.required.capabilities, [
    "event:publish",
    "event:subscribe",
    "feed:subscribe",
    "operation:call",
    "operation:cancel",
    "operation:observe",
    "rpc:call",
  ]);
  assertEquals(analysis.required.resources, [
    {
      kind: "transfer",
      alias: "example.api@v1:operation:Upload:send",
      required: true,
      definition: {
        type: "transfer",
        direction: "send",
        contractId: "example.api@v1",
        surfaceKind: "operation",
        surface: "Upload",
        materialization: "backing-store",
        store: "uploads",
        key: "/key",
      },
    },
    {
      kind: "transfer",
      alias: "example.api@v1:rpc:Ping:receive",
      required: true,
      definition: {
        type: "transfer",
        direction: "receive",
        contractId: "example.api@v1",
        surfaceKind: "rpc",
        surface: "Ping",
        materialization: "backing-store",
      },
    },
  ]);
});

Deno.test("analyzeContractProposal derives optional uses and skips missing optional surfaces", async () => {
  const store = createTestContracts([{
    digest: "dep-digest",
    contract: dependencyContract(),
  }]);

  const analysis = await analyzeContractProposal(store, {
    format: "trellis.contract.v1",
    id: "example.agent@v1",
    displayName: "Example Agent",
    description: "Agent contract",
    kind: "agent",
    uses: {
      optional: {
        api: {
          contract: "example.api@v1",
          rpc: { call: ["Ping", "MissingRpc"] },
          events: { subscribe: ["Changed", "MissingEvent"] },
        },
        missing: {
          contract: "missing.api@v1",
          rpc: { call: ["Nope"] },
        },
      },
    },
  });

  assertEquals(analysis.required, {
    contracts: [],
    surfaces: [],
    capabilities: [],
    resources: [],
  });
  assertEquals(analysis.optional.contracts, [
    { contractId: "example.api@v1", required: false },
  ]);
  assertEquals(analysis.optional.surfaces, [
    {
      contractId: "example.api@v1",
      kind: "event",
      name: "Changed",
      action: "subscribe",
      required: false,
    },
    {
      contractId: "example.api@v1",
      kind: "rpc",
      name: "Ping",
      action: "call",
      required: false,
    },
  ]);
  assertEquals(analysis.optional.capabilities, ["event:subscribe", "rpc:call"]);
});

Deno.test("analyzeContractProposal rejects missing required uses", async () => {
  const store = createTestContracts();

  await assertRejects(
    () =>
      analyzeContractProposal(store, {
        format: "trellis.contract.v1",
        id: "example.app@v1",
        displayName: "Example App",
        description: "App contract",
        kind: "app",
        uses: {
          required: {
            api: { contract: "missing.api@v1", rpc: { call: ["Ping"] } },
          },
        },
      }),
    Error,
    "inactive contract 'missing.api@v1'",
  );
});

Deno.test("analyzeContractProposal preserves contract-only uses", async () => {
  const store = createTestContracts([{
    digest: "dep-digest",
    contract: dependencyContract(),
  }]);

  const analysis = await analyzeContractProposal(store, {
    format: "trellis.contract.v1",
    id: "example.app@v1",
    displayName: "Example App",
    description: "App contract",
    kind: "app",
    uses: {
      required: {
        api: { contract: "example.api@v1" },
      },
      optional: {
        missing: { contract: "missing.api@v1" },
      },
    },
  });

  assertEquals(analysis.required.contracts, [
    { contractId: "example.api@v1", required: true },
  ]);
  assertEquals(analysis.required.surfaces, []);
  assertEquals(analysis.optional.contracts, []);
});

Deno.test("analyzeContractProposal knownOrPending prefers active dependency entries", async () => {
  const activeDependency = dependencyContract();
  const inactiveDependency = dependencyContract();
  inactiveDependency.schemas = {
    Empty: { type: "string" },
  };
  const store = createTestContracts([{
    digest: "active-dep-digest",
    contract: activeDependency,
  }]);
  store.addKnownTestContract({
    digest: "inactive-dep-digest",
    contract: inactiveDependency,
  });

  const analysis = await analyzeContractProposal(
    store,
    {
      format: "trellis.contract.v1",
      id: "example.service@v1",
      displayName: "Example Service",
      description: "Service contract",
      kind: "service",
      uses: {
        required: {
          api: { contract: "example.api@v1", rpc: { call: ["Ping"] } },
        },
      },
    },
    { dependencyResolution: "knownOrPending" },
  );

  assertEquals(analysis.required.surfaces, [
    {
      contractId: "example.api@v1",
      kind: "rpc",
      name: "Ping",
      action: "call",
      required: true,
    },
  ]);
  assertEquals(analysis.required.capabilities, ["rpc:call"]);
});

Deno.test("analyzeContractProposal derives resources and jobs", async () => {
  const store = createTestContracts();

  const analysis = await analyzeContractProposal(store, {
    format: "trellis.contract.v1",
    id: "example.service@v1",
    displayName: "Example Service",
    description: "Service contract",
    kind: "service",
    schemas,
    resources: {
      kv: {
        cache: {
          purpose: "cache",
          schema: { schema: "Empty" },
          history: 3,
          ttlMs: 60000,
          maxValueBytes: 4096,
        },
        hints: {
          purpose: "hints",
          schema: { schema: "Empty" },
          required: false,
        },
      },
      store: {
        uploads: {
          purpose: "uploads",
          required: false,
          ttlMs: 120000,
          maxObjectBytes: 1048576,
          maxTotalBytes: 10485760,
        },
      },
    },
    jobs: {
      Import: {
        payload: { schema: "Empty" },
        result: { schema: "Empty" },
        maxDeliver: 7,
        backoffMs: [1000, 2000],
        ackWaitMs: 30000,
        defaultDeadlineMs: 90000,
        progress: false,
        logs: false,
        dlq: false,
        concurrency: 2,
      },
    },
  });

  assertEquals(analysis.resources, [
    {
      kind: "jobs",
      alias: "Import",
      required: true,
      definition: {
        type: "jobs-queue",
        queueType: "Import",
        payload: { schema: "Empty" },
        result: { schema: "Empty" },
        maxDeliver: 7,
        backoffMs: [1000, 2000],
        ackWaitMs: 30000,
        defaultDeadlineMs: 90000,
        progress: false,
        logs: false,
        dlq: false,
        concurrency: 2,
      },
    },
    {
      kind: "kv",
      alias: "cache",
      required: true,
      definition: {
        type: "kv",
        history: 3,
        ttlMs: 60000,
        maxValueBytes: 4096,
        schema: { name: "Empty", exported: false },
      },
    },
    {
      kind: "kv",
      alias: "hints",
      required: false,
      definition: {
        type: "kv",
        history: 1,
        ttlMs: 0,
        schema: { name: "Empty", exported: false },
      },
    },
    {
      kind: "store",
      alias: "uploads",
      required: false,
      definition: {
        type: "store",
        ttlMs: 120000,
        maxObjectBytes: 1048576,
        maxTotalBytes: 10485760,
      },
    },
  ]);
  assertEquals(analysis.required.resources, [
    analysis.resources[0],
    analysis.resources[1],
  ]);
  assertEquals(analysis.optional.resources, [
    analysis.resources[2],
    analysis.resources[3],
  ]);
});

Deno.test("analyzeContractProposal derives event consumer resources", async () => {
  const store = createTestContracts([{
    digest: "dep-digest",
    contract: dependencyContract(),
  }]);

  const analysis = await analyzeContractProposal(store, {
    format: "trellis.contract.v1",
    id: "example.service@v1",
    displayName: "Example Service",
    description: "Service contract",
    kind: "service",
    uses: {
      required: {
        api: {
          contract: "example.api@v1",
          events: { subscribe: ["Changed"] },
        },
      },
    },
    eventConsumers: {
      ingest: {
        events: [{ use: "api", event: "Changed" }],
        replay: "all",
        concurrency: 1,
        ackWaitMs: 45000,
        maxDeliver: 3,
        backoffMs: [1000, 2000],
      },
    },
  });

  assertEquals(analysis.resources, [
    {
      kind: "event-consumer",
      alias: "ingest",
      required: true,
      definition: {
        type: "event-consumer",
        stream: "trellis",
        filterSubjects: ["events.v1.example.Changed"],
        eventRefs: [{ use: "api", event: "Changed" }],
        replay: "all",
        ordering: "strict",
        concurrency: 1,
        ackWaitMs: 45000,
        maxDeliver: 3,
        backoffMs: [1000, 2000],
      },
    },
  ]);
  assertEquals(analysis.required.resources, [
    analysis.resources[0],
  ]);
});

Deno.test("analyzeContractProposal includes operation control and open cancel needs", async () => {
  const store = createTestContracts([{
    digest: "dep-digest",
    contract: {
      ...dependencyContract(),
      operations: {
        Signal: {
          version: "v1",
          subject: "operations.v1.example.Signal",
          input: { schema: "Empty" },
          output: { schema: "Empty" },
          cancel: true,
          capabilities: {
            call: ["operation:call"],
            observe: ["operation:observe"],
            control: ["operation:control"],
          },
          signals: {
            Pause: { input: { schema: "Empty" } },
          },
        },
      },
    },
  }]);

  const analysis = await analyzeContractProposal(store, {
    format: "trellis.contract.v1",
    id: "example.app@v1",
    displayName: "Example App",
    description: "App contract",
    kind: "app",
    uses: {
      required: {
        api: { contract: "example.api@v1", operations: { call: ["Signal"] } },
      },
    },
  });

  assertEquals(analysis.required.surfaces, [
    {
      contractId: "example.api@v1",
      kind: "operation",
      name: "Signal",
      action: "call",
      required: true,
    },
    {
      contractId: "example.api@v1",
      kind: "operation",
      name: "Signal",
      action: "cancel",
      required: true,
    },
    {
      contractId: "example.api@v1",
      kind: "operation",
      name: "Signal",
      action: "observe",
      required: true,
    },
  ]);
  assertEquals(analysis.required.capabilities, [
    "operation:call",
    "operation:control",
    "operation:observe",
  ]);
});

Deno.test("analyzeContractProposal derives transfer resource requirements", async () => {
  const store = createTestContracts([{
    digest: "dep-digest",
    contract: dependencyContract(),
  }]);

  const analysis = await analyzeContractProposal(store, {
    format: "trellis.contract.v1",
    id: "example.device@v1",
    displayName: "Example Device",
    description: "Device contract",
    kind: "device",
    schemas,
    rpc: {
      Download: {
        version: "v1",
        subject: "rpc.v1.example.Download",
        input: { schema: "Empty" },
        output: { schema: "Empty" },
        transfer: { direction: "receive" },
      },
    },
    operations: {
      Upload: {
        version: "v1",
        subject: "operations.v1.example.Upload",
        input: { schema: "Empty" },
        output: { schema: "Empty" },
        transfer: { direction: "send", store: "uploads", key: "/key" },
      },
    },
    uses: {
      required: {
        api: {
          contract: "example.api@v1",
          rpc: { call: ["Ping"] },
          operations: { call: ["Upload"] },
        },
      },
    },
  });

  assertEquals(analysis.required.resources, [
    {
      kind: "transfer",
      alias: "example.api@v1:operation:Upload:send",
      required: true,
      definition: {
        type: "transfer",
        direction: "send",
        contractId: "example.api@v1",
        surfaceKind: "operation",
        surface: "Upload",
        materialization: "backing-store",
        store: "uploads",
        key: "/key",
      },
    },
    {
      kind: "transfer",
      alias: "example.api@v1:rpc:Ping:receive",
      required: true,
      definition: {
        type: "transfer",
        direction: "receive",
        contractId: "example.api@v1",
        surfaceKind: "rpc",
        surface: "Ping",
        materialization: "backing-store",
      },
    },
    {
      kind: "transfer",
      alias: "example.device@v1:operation:Upload:send",
      required: true,
      definition: {
        type: "transfer",
        direction: "send",
        contractId: "example.device@v1",
        surfaceKind: "operation",
        surface: "Upload",
        materialization: "backing-store",
        store: "uploads",
        key: "/key",
      },
    },
    {
      kind: "transfer",
      alias: "example.device@v1:rpc:Download:receive",
      required: true,
      definition: {
        type: "transfer",
        direction: "receive",
        contractId: "example.device@v1",
        surfaceKind: "rpc",
        surface: "Download",
        materialization: "backing-store",
      },
    },
  ]);
});

Deno.test("analyzeContractProposal derives contributed surfaces", async () => {
  const store = createTestContracts();

  const analysis = await analyzeContractProposal(
    store,
    dependencyContract(),
  );

  assertEquals(analysis.contributedAvailability.contracts, [
    { contractId: "example.api@v1", required: true },
  ]);
  assertEquals(analysis.contributedAvailability.surfaces, [
    {
      contractId: "example.api@v1",
      kind: "event",
      name: "Changed",
      action: "publish",
      required: true,
    },
    {
      contractId: "example.api@v1",
      kind: "event",
      name: "Changed",
      action: "subscribe",
      required: true,
    },
    {
      contractId: "example.api@v1",
      kind: "feed",
      name: "Live",
      action: "subscribe",
      required: true,
    },
    {
      contractId: "example.api@v1",
      kind: "operation",
      name: "Upload",
      action: "call",
      required: true,
    },
    {
      contractId: "example.api@v1",
      kind: "operation",
      name: "Upload",
      action: "cancel",
      required: true,
    },
    {
      contractId: "example.api@v1",
      kind: "operation",
      name: "Upload",
      action: "observe",
      required: true,
    },
    {
      contractId: "example.api@v1",
      kind: "rpc",
      name: "Ping",
      action: "call",
      required: true,
    },
  ]);
  assertEquals(analysis.contributedAvailability.capabilities, []);
  assertEquals(
    analysis.capabilityDefinitions.map((definition) => ({
      key: definition.key,
      displayName: definition.displayName,
      description: definition.description,
      direction: definition.direction,
    })),
    [
      {
        key: "event:publish",
        displayName: "Publish event",
        description: "Publish events.",
        direction: "creates",
      },
      {
        key: "event:subscribe",
        displayName: "Subscribe event",
        description: "Subscribe to events.",
        direction: "creates",
      },
      {
        key: "feed:subscribe",
        displayName: "Subscribe feed",
        description: "Subscribe to feeds.",
        direction: "creates",
      },
      {
        key: "operation:call",
        displayName: "Call operation",
        description: "Start operations.",
        direction: "creates",
      },
      {
        key: "operation:cancel",
        displayName: "Cancel operation",
        description: "Cancel operations.",
        direction: "creates",
      },
      {
        key: "operation:observe",
        displayName: "Observe operation",
        description: "Observe operations.",
        direction: "creates",
      },
      {
        key: "rpc:call",
        displayName: "Call RPC",
        description: "Call RPC methods.",
        direction: "creates",
      },
    ],
  );
});

Deno.test("analyzeContractProposal creates fallback definitions for owned surface capabilities", async () => {
  const analysis = await analyzeContractProposal(createTestContracts(), {
    ...dependencyContract(),
    capabilities: {},
  });

  assertEquals(
    analysis.capabilityDefinitions.map((definition) => ({
      key: definition.key,
      displayName: definition.displayName,
      description: definition.description,
      direction: definition.direction,
    })),
    [
      {
        key: "event:publish",
        displayName: "event:publish",
        description: "Requires event:publish.",
        direction: "creates",
      },
      {
        key: "event:subscribe",
        displayName: "event:subscribe",
        description: "Requires event:subscribe.",
        direction: "creates",
      },
      {
        key: "feed:subscribe",
        displayName: "feed:subscribe",
        description: "Requires feed:subscribe.",
        direction: "creates",
      },
      {
        key: "operation:call",
        displayName: "operation:call",
        description: "Requires operation:call.",
        direction: "creates",
      },
      {
        key: "operation:cancel",
        displayName: "operation:cancel",
        description: "Requires operation:cancel.",
        direction: "creates",
      },
      {
        key: "operation:observe",
        displayName: "operation:observe",
        description: "Requires operation:observe.",
        direction: "creates",
      },
      {
        key: "rpc:call",
        displayName: "rpc:call",
        description: "Requires rpc:call.",
        direction: "creates",
      },
    ],
  );
});
