import type { TrellisContractV1 } from "@qlever-llc/trellis-contracts";
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
      AuthConnectEvent: { type: "object" },
      AuthAuditMessage: { type: "object" },
    },
    rpc: {
      "Auth.Me": {
        version: "v1",
        subject: "rpc.v1.example.Auth.Me",
        input: { schema: "EmptyInput" },
        output: { schema: "EmptyOutput" },
        capabilities: { call: ["users:read"] },
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
    subjects: {
      AuthAudit: {
        subject: "nats.example.audit",
        message: { schema: "AuthAuditMessage" },
        capabilities: { publish: ["audit:write"], subscribe: ["audit:read"] },
      },
    },
  };

  const store = new ContractStore([{ digest: "dep-digest", contract: dependency }]);

  const plan = await planUserContractApproval(store, {
    format: "trellis.contract.v1",
    id: "example.console@v1",
    displayName: "Example Console",
    description: "Browser app",
    kind: "app",
    uses: {
      auth: {
        contract: "example.auth@v1",
        rpc: { call: ["Auth.Me"] },
        events: { subscribe: ["Auth.Connect"] },
        subjects: { subscribe: ["AuthAudit"] },
      },
    },
  });

  assertEquals(plan.approval.contractId, "example.console@v1");
  assertEquals(plan.approval.capabilities, ["audit:read", "users:read"]);
  assertEquals(plan.publishSubjects, ["rpc.v1.example.Auth.Me"]);
  assertEquals(plan.subscribeSubjects, [
    "events.v1.example.Auth.Connect",
    "nats.example.audit",
  ]);
});

Deno.test("planUserContractApproval skips inactive dependencies for app login", async () => {
  const store = new ContractStore();

  const plan = await planUserContractApproval(store, {
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
  });

  assertEquals(plan.approval.contractId, "example.console@v1");
  assertEquals(plan.approval.capabilities, []);
  assertEquals(plan.publishSubjects, []);
  assertEquals(plan.subscribeSubjects, []);
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

  const store = new ContractStore([{ digest: "dep-digest", contract: dependency }]);

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
