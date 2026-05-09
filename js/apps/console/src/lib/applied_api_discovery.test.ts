import { deepEqual } from "node:assert/strict";
import {
  getAppliedApiSchemaRows,
  getAppliedApiUseRows,
} from "./applied_api_discovery.ts";

declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void;
};

const installedContract = {
  digest: "digest1",
  id: "documents@v1",
  displayName: "Documents",
  description: "Document APIs",
  installedAt: "2026-01-01T00:00:00.000Z",
  analysisSummary: {
    events: 1,
    jobsQueues: 1,
    kvResources: 1,
    namespaces: ["documents"],
    natsPublish: 1,
    natsSubscribe: 1,
    operationControls: 4,
    operations: 2,
    rpcMethods: 3,
    storeResources: 1,
  },
  contract: {
    format: "trellis.contract.v1",
    id: "documents@v1",
    displayName: "Documents",
    description: "Document APIs",
    kind: "service",
    schemas: {
      Document: { type: "object", properties: { id: { type: "string" } } },
      Empty: true,
      ProcessDocumentProgress: { type: "object" },
      ProcessDocumentResult: { type: "object" },
    },
    exports: { schemas: ["Document"] },
    rpc: {
      "Documents.Get": {
        version: "v1",
        subject: "rpc.v1.Documents.Get",
        input: { schema: "Document" },
        output: { schema: "Document" },
        description: "Fetch one document.",
      },
    },
    operations: {
      "Documents.Process": {
        version: "v1",
        subject: "operations.v1.Documents.Process",
        input: { schema: "Document" },
        progress: { schema: "ProcessDocumentProgress" },
        output: { schema: "ProcessDocumentResult" },
      },
    },
    events: {
      "Documents.Changed": {
        version: "v1",
        subject: "events.v1.Documents.Changed",
        event: { schema: "Document" },
        documentation: "Published after document metadata changes.",
      },
    },
    uses: {
      auth: {
        contract: "trellis.auth@v1",
        rpc: { call: ["Auth.Sessions.Me"] },
        events: { subscribe: ["Auth.Connections.Opened"] },
      },
    },
  },
  analysis: {
    namespaces: ["documents"],
    rpc: {
      methods: [{
        key: "Documents.Get",
        subject: "rpc.v1.Documents.Get",
        wildcardSubject: "rpc.v1.Documents.Get",
        callerCapabilities: ["documents::read"],
      }],
    },
    operations: {
      operations: [{
        key: "Documents.Process",
        subject: "operations.v1.Documents.Process",
        wildcardSubject: "operations.v1.Documents.Process",
        controlSubject: "operations.v1.Documents.Process.control",
        wildcardControlSubject: "operations.v1.Documents.Process.control",
        callCapabilities: ["documents::write"],
        readCapabilities: ["documents::read"],
        cancelCapabilities: [],
        cancel: false,
      }],
      control: [],
    },
    events: {
      events: [{
        key: "Documents.Changed",
        subject: "events.v1.Documents.Changed",
        wildcardSubject: "events.v1.Documents.Changed",
        publishCapabilities: ["documents::write"],
        subscribeCapabilities: ["documents::read"],
      }],
    },
    nats: { publish: [], subscribe: [] },
    resources: { kv: [], store: [], jobs: [] },
  },
};

Deno.test("getAppliedApiSchemaRows extracts schema rows and export state", () => {
  const rows = getAppliedApiSchemaRows(installedContract);

  deepEqual(rows.map((row) => [row.name, row.type, row.exported]), [
    ["Document", "object", true],
    ["Empty", "true", false],
    ["ProcessDocumentProgress", "object", false],
    ["ProcessDocumentResult", "object", false],
  ]);
});

Deno.test("getAppliedApiUseRows extracts declared cross-contract uses", () => {
  const rows = getAppliedApiUseRows(installedContract);

  deepEqual(rows, [{
    alias: "auth",
    contractId: "trellis.auth@v1",
    rpcCalls: ["Auth.Sessions.Me"],
    operationCalls: [],
    eventPublishes: [],
    eventSubscribes: ["Auth.Connections.Opened"],
  }]);
});
