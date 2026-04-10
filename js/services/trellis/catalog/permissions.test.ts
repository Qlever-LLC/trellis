import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { assertEquals } from "@std/assert";

import {
  getContracts,
  getServicePublishSubjects,
  getServiceSubscribeSubjects,
  getUserPublishSubjects,
  getUserSubscribeSubjects,
  setContracts,
} from "./permissions.ts";

const TEST_CONTRACTS: Array<{ digest: string; contract: TrellisContractV1 }> = [
  {
    digest: "trellis.core@v1",
    contract: {
      format: "trellis.contract.v1",
      id: "trellis.core@v1",
      displayName: "Trellis Core",
      description: "Provide core Trellis APIs.",
      schemas: {
        EmptyInput: { type: "object" },
        EmptyOutput: { type: "object" },
      },
      rpc: {
        "Trellis.Catalog": {
          version: "v1",
          subject: "rpc.v1.Trellis.Catalog",
          input: { schema: "EmptyInput" },
          output: { schema: "EmptyOutput" },
          capabilities: { call: ["trellis.catalog.read"] },
        },
        "Trellis.Contract.Get": {
          version: "v1",
          subject: "rpc.v1.Trellis.Contract.Get",
          input: { schema: "EmptyInput" },
          output: { schema: "EmptyOutput" },
          capabilities: { call: ["trellis.contract.read"] },
        },
      },
    },
  },
  {
    digest: "trellis.auth@v1",
    contract: {
      format: "trellis.contract.v1",
      id: "trellis.auth@v1",
      displayName: "Trellis Auth",
      description: "Provide Trellis auth APIs.",
      schemas: {
        AuthConnectEvent: { type: "object" },
      },
      events: {
        "Auth.Connect": {
          version: "v1",
          subject: "events.v1.Auth.Connect",
          event: { schema: "AuthConnectEvent" },
          capabilities: {
            publish: ["service:events:auth"],
            subscribe: ["service:events:auth"],
          },
        },
      },
    },
  },
  {
    digest: "graph-digest",
    contract: {
      format: "trellis.contract.v1",
      id: "graph@v1",
      displayName: "Graph",
      description: "Expose graph RPC and event subjects.",
      schemas: {
        EmptyInput: { type: "object" },
        EmptyOutput: { type: "object" },
        PartnerChangedEvent: { type: "object" },
      },
      uses: {
        core: {
          contract: "trellis.core@v1",
          rpc: { call: ["Trellis.Catalog"] },
        },
        auth: {
          contract: "trellis.auth@v1",
          events: { subscribe: ["Auth.Connect"] },
        },
      },
      rpc: {
        "Partner.List": {
          version: "v1",
          subject: "rpc.v1.Partner.List",
          input: { schema: "EmptyInput" },
          output: { schema: "EmptyOutput" },
          capabilities: { call: ["partners:read"] },
        },
      },
      events: {
        "Partner.Changed": {
          version: "v1",
          subject: "events.v1.Partner.Changed.{/partner/id/origin}.{/partner/id/id}",
          params: ["/partner/id/origin", "/partner/id/id"],
          event: { schema: "PartnerChangedEvent" },
          capabilities: {
            publish: ["partners:write"],
            subscribe: ["partners:read"],
          },
        },
      },
      subjects: {
        "Jobs.Stream": {
          subject: "trellis.jobs.>",
          capabilities: {
            publish: ["jobs.publish"],
            subscribe: ["jobs.subscribe"],
          },
        },
      },
    },
  },
];

function withContracts(contracts: typeof TEST_CONTRACTS, fn: () => void) {
  const original = getContracts();
  setContracts(contracts);
  try {
    fn();
  } finally {
    setContracts(original);
  }
}

Deno.test("user permissions do not include RPC subscribe", () => {
  withContracts(TEST_CONTRACTS, () => {
    const userRoles = ["partners:read"];
    const pubSubjects = getUserPublishSubjects(userRoles);
    const subSubjects = getUserSubscribeSubjects(userRoles);

    assertEquals(pubSubjects.includes("rpc.v1.Partner.List"), true);
    assertEquals(subSubjects.includes("rpc.v1.Partner.List"), false);
    assertEquals(subSubjects.includes("rpc.*"), false);
    assertEquals(subSubjects.includes("_INBOX.>"), false);
  });
});

Deno.test("user permissions include event and raw subject capabilities", () => {
  withContracts(TEST_CONTRACTS, () => {
    const publishSubjects = getUserPublishSubjects([
      "partners:write",
      "jobs.publish",
    ]);
    const subscribeSubjects = getUserSubscribeSubjects([
      "partners:read",
      "jobs.subscribe",
    ]);

    assertEquals(
      publishSubjects.includes("events.v1.Partner.Changed.*.*"),
      true,
    );
    assertEquals(publishSubjects.includes("trellis.jobs.>"), true);
    assertEquals(
      subscribeSubjects.includes("events.v1.Partner.Changed.*.*"),
      true,
    );
    assertEquals(subscribeSubjects.includes("trellis.jobs.>"), true);
  });
});

Deno.test("service permissions include owned RPCs and declared dependencies", () => {
  withContracts(TEST_CONTRACTS, () => {
    const publishSubjects = getServicePublishSubjects(
      ["service", "jobs.publish", "trellis.catalog.read", "service:events:auth"],
      { sessionKey: "graph-key", contractDigest: "graph-digest", displayName: "graph" },
    );
    const subscribeSubjects = getServiceSubscribeSubjects(
      ["service", "jobs.subscribe", "service:events:auth"],
      { sessionKey: "graph-key", contractDigest: "graph-digest", displayName: "graph" },
    );

    assertEquals(publishSubjects.includes("trellis.jobs.>"), true);
    assertEquals(publishSubjects.includes("rpc.v1.Trellis.Catalog"), true);
    assertEquals(subscribeSubjects.includes("rpc.v1.Partner.List"), true);
    assertEquals(subscribeSubjects.includes("trellis.jobs.>"), true);
    assertEquals(subscribeSubjects.includes("events.v1.Auth.Connect"), true);
  });
});

Deno.test("service event subscriptions include JetStream control subjects", () => {
  withContracts(TEST_CONTRACTS, () => {
    const publishSubjects = getServicePublishSubjects(
      ["service", "service:events:auth"],
      { sessionKey: "graph-key", contractDigest: "graph-digest", displayName: "graph" },
    );

    assertEquals(publishSubjects.includes("$JS.API.INFO"), true);
    assertEquals(publishSubjects.includes("$JS.API.CONSUMER.DURABLE.CREATE.trellis.>"), true);
    assertEquals(publishSubjects.includes("$JS.API.CONSUMER.INFO.trellis.>"), true);
    assertEquals(publishSubjects.includes("$JS.API.CONSUMER.MSG.NEXT.trellis.>"), true);
    assertEquals(publishSubjects.includes("$JS.ACK.>"), true);
  });
});

Deno.test("service cannot call undeclared cross-contract RPCs by capability alone", () => {
  withContracts(TEST_CONTRACTS, () => {
    const publishSubjects = getServicePublishSubjects(
      ["service", "trellis.catalog.read", "trellis.contract.read"],
      { sessionKey: "graph-key", contractDigest: "graph-digest", displayName: "graph" },
    );

    assertEquals(publishSubjects.includes("rpc.v1.Trellis.Catalog"), true);
    assertEquals(publishSubjects.includes("rpc.v1.Trellis.Contract.Get"), false);
  });
});
