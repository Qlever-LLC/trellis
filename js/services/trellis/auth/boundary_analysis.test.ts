import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { assertEquals, assertRejects } from "@std/assert";

import { createTestContracts } from "../catalog/test_contracts.ts";
import { analyzeContractEnvelopeBoundary } from "./boundary_analysis.ts";

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
      "operation:read": {
        displayName: "Read operation",
        description: "Read operations.",
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
      "feed:read": {
        displayName: "Read feed",
        description: "Read feeds.",
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
          read: ["operation:read"],
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
        capabilities: { subscribe: ["feed:read"] },
      },
    },
  };
}

Deno.test("analyzeContractEnvelopeBoundary derives required uses", async () => {
  const store = createTestContracts([{
    digest: "dep-digest",
    contract: dependencyContract(),
  }]);

  const analysis = await analyzeContractEnvelopeBoundary(store, {
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
      action: "read",
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
      action: "read",
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
    "feed:read",
    "operation:call",
    "operation:cancel",
    "operation:read",
    "rpc:call",
  ]);
  assertEquals(analysis.required.resources, [
    { kind: "transfer", alias: "download", required: true },
    { kind: "transfer", alias: "upload", required: true },
  ]);
});

Deno.test("analyzeContractEnvelopeBoundary derives optional uses and skips missing optional surfaces", async () => {
  const store = createTestContracts([{
    digest: "dep-digest",
    contract: dependencyContract(),
  }]);

  const analysis = await analyzeContractEnvelopeBoundary(store, {
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

Deno.test("analyzeContractEnvelopeBoundary rejects missing required uses", async () => {
  const store = createTestContracts();

  await assertRejects(
    () =>
      analyzeContractEnvelopeBoundary(store, {
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

Deno.test("analyzeContractEnvelopeBoundary preserves contract-only uses", async () => {
  const store = createTestContracts([{
    digest: "dep-digest",
    contract: dependencyContract(),
  }]);

  const analysis = await analyzeContractEnvelopeBoundary(store, {
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

Deno.test("analyzeContractEnvelopeBoundary knownOrPending prefers active dependency entries", async () => {
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

  const analysis = await analyzeContractEnvelopeBoundary(
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

Deno.test("analyzeContractEnvelopeBoundary derives resources and jobs", async () => {
  const store = createTestContracts();

  const analysis = await analyzeContractEnvelopeBoundary(store, {
    format: "trellis.contract.v1",
    id: "example.service@v1",
    displayName: "Example Service",
    description: "Service contract",
    kind: "service",
    schemas,
    resources: {
      kv: {
        cache: { purpose: "cache", schema: { schema: "Empty" } },
        hints: {
          purpose: "hints",
          schema: { schema: "Empty" },
          required: false,
        },
      },
      store: {
        uploads: { purpose: "uploads", required: false },
      },
    },
    jobs: {
      Import: { payload: { schema: "Empty" }, result: { schema: "Empty" } },
    },
  });

  assertEquals(analysis.resources, [
    { kind: "jobs", alias: "Import", required: true },
    { kind: "kv", alias: "cache", required: true },
    { kind: "kv", alias: "hints", required: false },
    { kind: "store", alias: "uploads", required: false },
  ]);
  assertEquals(analysis.required.resources, [
    { kind: "jobs", alias: "Import", required: true },
    { kind: "kv", alias: "cache", required: true },
  ]);
  assertEquals(analysis.optional.resources, [
    { kind: "kv", alias: "hints", required: false },
    { kind: "store", alias: "uploads", required: false },
  ]);
});

Deno.test("analyzeContractEnvelopeBoundary includes operation control and open cancel boundaries", async () => {
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
            read: ["operation:read"],
            control: ["operation:control"],
          },
          signals: {
            Pause: { input: { schema: "Empty" } },
          },
        },
      },
    },
  }]);

  const analysis = await analyzeContractEnvelopeBoundary(store, {
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
      action: "read",
      required: true,
    },
  ]);
  assertEquals(analysis.required.capabilities, [
    "operation:call",
    "operation:control",
    "operation:read",
  ]);
});

Deno.test("analyzeContractEnvelopeBoundary derives transfer resource requirements", async () => {
  const store = createTestContracts([{
    digest: "dep-digest",
    contract: dependencyContract(),
  }]);

  const analysis = await analyzeContractEnvelopeBoundary(store, {
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
    { kind: "transfer", alias: "download", required: true },
    { kind: "transfer", alias: "upload", required: true },
  ]);
});

Deno.test("analyzeContractEnvelopeBoundary derives contributed surfaces", async () => {
  const store = createTestContracts();

  const analysis = await analyzeContractEnvelopeBoundary(
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
      action: "read",
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
      action: "read",
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
});
