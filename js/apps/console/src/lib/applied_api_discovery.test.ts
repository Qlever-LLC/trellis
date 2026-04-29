import { deepEqual, equal } from "node:assert/strict";
import type {
  AuthGetInstalledContractOutput,
  AuthListServiceDeploymentsOutput,
  AuthListServiceInstancesOutput,
} from "@qlever-llc/trellis/sdk/auth";

import {
  getAppliedApiDependencyGraph,
  getAppliedApiSchemaRows,
  getAppliedApiUseRows,
  getAppliedContractApiSummaries,
} from "./applied_api_discovery.ts";

declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void;
};

const installedContract: AuthGetInstalledContractOutput["contract"] = {
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
    },
    exports: { schemas: ["Document"] },
    uses: {
      auth: {
        contract: "trellis.auth@v1",
        rpc: { call: ["Auth.Me"] },
        events: { subscribe: ["Auth.Connect"] },
      },
    },
  },
};

Deno.test("getAppliedApiSchemaRows extracts schema rows and export state", () => {
  const rows = getAppliedApiSchemaRows(installedContract);

  deepEqual(rows.map((row) => [row.name, row.type, row.exported]), [
    ["Document", "object", true],
    ["Empty", "true", false],
  ]);
});

Deno.test("getAppliedApiUseRows extracts declared cross-contract uses", () => {
  const rows = getAppliedApiUseRows(installedContract);

  deepEqual(rows, [{
    alias: "auth",
    contractId: "trellis.auth@v1",
    rpcCalls: ["Auth.Me"],
    operationCalls: [],
    eventPublishes: [],
    eventSubscribes: ["Auth.Connect"],
  }]);
});

Deno.test("getAppliedContractApiSummaries combines deployment, instance, and contract details", () => {
  const deployments: AuthListServiceDeploymentsOutput = {
    deployments: [{
      deploymentId: "documents-prod",
      disabled: false,
      namespaces: ["fallback"],
      appliedContracts: [{
        contractId: "documents@v1",
        allowedDigests: ["digest1"],
        resourceBindingsByDigest: {
          digest1: {
            jobs: {
              namespace: "documents",
              queues: {
                process: {
                  ackWaitMs: 30_000,
                  backoffMs: [1_000],
                  concurrency: 1,
                  consumerName: "documents-process",
                  dlq: true,
                  logs: true,
                  maxDeliver: 3,
                  payload: { schema: "Document" },
                  progress: true,
                  publishPrefix: "jobs.documents",
                  queueType: "process",
                  workSubject: "jobs.documents.process",
                },
              },
            },
            kv: { state: { bucket: "documents-state", history: 1, ttlMs: 0 } },
            store: { files: { name: "documents-files", ttlMs: 0 } },
          },
        },
      }],
    }],
  };
  const instances: AuthListServiceInstancesOutput = {
    instances: [{
      capabilities: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      currentContractDigest: "digest1",
      currentContractId: "documents@v1",
      deploymentId: "documents-prod",
      disabled: false,
      instanceId: "instance-1",
      instanceKey: "key-1",
    }],
  };

  const rows = getAppliedContractApiSummaries(
    deployments,
    instances,
    [installedContract],
  );

  equal(rows.length, 1);
  deepEqual(rows[0], {
    id: "documents-prod:documents@v1:digest1",
    deploymentId: "documents-prod",
    contractId: "documents@v1",
    digest: "digest1",
    displayName: "Documents",
    description: "Document APIs",
    disabled: false,
    activeInstances: 1,
    namespaces: ["documents"],
    rpcMethods: 3,
    operations: 2,
    events: 1,
    kvResources: 1,
    storeResources: 1,
    jobsQueues: 1,
    boundKvResources: 1,
    boundStoreResources: 1,
    boundJobQueues: 1,
  });
});

Deno.test("getAppliedApiDependencyGraph links deployments, applied contracts, and uses", () => {
  const graph = getAppliedApiDependencyGraph(
    {
      deployments: [{
        deploymentId: "documents-prod",
        disabled: false,
        namespaces: ["documents"],
        appliedContracts: [{
          contractId: "documents@v1",
          allowedDigests: ["digest1"],
        }],
      }],
    },
    { instances: [] },
    [installedContract],
  );

  deepEqual(graph.nodes.map((node) => [node.id, node.kind]), [
    ["contract:documents@v1:digest1", "contract"],
    ["contract:trellis.auth@v1", "external-contract"],
    ["deployment:documents-prod", "deployment"],
  ]);
  deepEqual(graph.edges.map((edge) => [edge.kind, edge.source, edge.target]), [
    ["applies", "deployment:documents-prod", "contract:documents@v1:digest1"],
    ["uses", "contract:documents@v1:digest1", "contract:trellis.auth@v1"],
  ]);
});
