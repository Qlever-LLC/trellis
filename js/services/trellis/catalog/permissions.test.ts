import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { assertEquals, assertThrows } from "@std/assert";

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
      kind: "service",
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
      kind: "service",
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
      kind: "service",
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
        billing: {
          contract: "billing@v1",
          operations: { call: ["Billing.Refund"] },
        },
      },
      rpc: {
        "Partner.List": {
          version: "v1",
          subject: "rpc.v1.Partner.List",
          input: { schema: "EmptyInput" },
          output: { schema: "EmptyOutput" },
          transfer: { direction: "receive" },
          capabilities: { call: ["partners:read"] },
        },
      },
      operations: {
        "Partner.Sync": {
          version: "v1",
          subject: "operations.v1.Partner.Sync",
          input: { schema: "EmptyInput" },
          output: { schema: "EmptyOutput" },
          transfer: {
            direction: "send",
            store: "uploads",
            key: "/key",
          },
          capabilities: {
            call: ["partners:write"],
            read: ["partners:read"],
          },
        },
      },
      events: {
        "Partner.Changed": {
          version: "v1",
          subject:
            "events.v1.Partner.Changed.{/partner/id/origin}.{/partner/id/id}",
          params: ["/partner/id/origin", "/partner/id/id"],
          event: { schema: "PartnerChangedEvent" },
          capabilities: {
            publish: ["partners:write"],
            subscribe: ["partners:read"],
          },
        },
      },
    },
  },
  {
    digest: "portal-digest",
    contract: {
      format: "trellis.contract.v1",
      id: "portal@v1",
      displayName: "Portal",
      description: "User-facing portal app.",
      kind: "app",
      uses: {
        graph: {
          contract: "graph@v1",
          rpc: { call: ["Partner.List"] },
          operations: { call: ["Partner.Sync"] },
          events: {
            publish: ["Partner.Changed"],
            subscribe: ["Partner.Changed"],
          },
        },
      },
    },
  },
  {
    digest: "billing-digest",
    contract: {
      format: "trellis.contract.v1",
      id: "billing@v1",
      displayName: "Billing",
      description: "Expose billing operations.",
      kind: "service",
      schemas: {
        EmptyInput: { type: "object" },
        EmptyOutput: { type: "object" },
      },
      operations: {
        "Billing.Refund": {
          version: "v1",
          subject: "operations.v1.Billing.Refund",
          input: { schema: "EmptyInput" },
          output: { schema: "EmptyOutput" },
          cancel: true,
          capabilities: {
            call: ["billing.refund"],
            read: ["billing.read"],
            cancel: ["billing.cancel"],
          },
        },
      },
    },
  },
];

function withContracts(contracts: typeof TEST_CONTRACTS, fn: () => void) {
  const original = getContracts();
  try {
    setContracts(contracts);
    fn();
  } finally {
    setContracts(original);
  }
}

Deno.test("user permissions do not include RPC subscribe", () => {
  withContracts(TEST_CONTRACTS, () => {
    const userRoles = ["partners:read"];
    const caller = { contractDigest: "portal-digest" };
    const pubSubjects = getUserPublishSubjects(userRoles, caller);
    const subSubjects = getUserSubscribeSubjects(userRoles, caller);

    assertEquals(pubSubjects.includes("rpc.v1.Partner.List"), true);
    assertEquals(subSubjects.includes("rpc.v1.Partner.List"), false);
    assertEquals(subSubjects.includes("rpc.*"), false);
    assertEquals(subSubjects.includes("_INBOX.>"), false);
  });
});

Deno.test("user permissions include event capabilities without raw subjects", () => {
  withContracts(TEST_CONTRACTS, () => {
    const caller = { contractDigest: "portal-digest" };
    const publishSubjects = getUserPublishSubjects([
      "partners:write",
    ], caller);
    const transferPublishSubjects = getUserPublishSubjects([
      "partners:read",
    ], caller);
    const subscribeSubjects = getUserSubscribeSubjects([
      "partners:read",
    ], caller);

    assertEquals(
      publishSubjects.includes("events.v1.Partner.Changed.*.*"),
      true,
    );
    assertEquals(publishSubjects.includes("operations.v1.Partner.Sync"), true);
    assertEquals(
      publishSubjects.includes("operations.v1.Partner.Sync.control"),
      false,
    );
    assertEquals(publishSubjects.includes("transfer.v1.upload.*.*"), true);
    assertEquals(
      transferPublishSubjects.includes("transfer.v1.download.*.*"),
      true,
    );
    assertEquals(
      subscribeSubjects.includes("events.v1.Partner.Changed.*.*"),
      true,
    );
    assertEquals(subscribeSubjects.includes("transfer.v1.download.*.*"), false);
  });
});

Deno.test("user permissions omit transfer subjects without explicit transfer uses", () => {
  withContracts(TEST_CONTRACTS, () => {
    const caller = { contractDigest: "portal-digest" };
    const publishSubjects = getUserPublishSubjects(["jobs.publish"], caller);
    const subscribeSubjects = getUserSubscribeSubjects(
      ["jobs.subscribe"],
      caller,
    );

    assertEquals(publishSubjects.includes("transfer.v1.upload.*.*"), false);
    assertEquals(publishSubjects.includes("transfer.v1.download.*.*"), false);
    assertEquals(subscribeSubjects.includes("transfer.v1.upload.*.*"), false);
    assertEquals(subscribeSubjects.includes("transfer.v1.download.*.*"), false);
  });
});

Deno.test("user cannot call unrelated active RPC by capability alone", () => {
  withContracts(TEST_CONTRACTS, () => {
    const publishSubjects = getUserPublishSubjects(
      ["trellis.contract.read"],
      { contractDigest: "portal-digest" },
    );

    assertEquals(
      publishSubjects.includes("rpc.v1.Trellis.Contract.Get"),
      false,
    );
  });
});

Deno.test("user uses resolution allows multiple active compatible digests", () => {
  const newerCore = {
    digest: "trellis-core-newer-digest",
    contract: {
      ...TEST_CONTRACTS[0].contract,
      rpc: {
        ...TEST_CONTRACTS[0].contract.rpc,
        "Trellis.Health": {
          version: "v1" as const,
          subject: "rpc.v1.Trellis.Health",
          input: { schema: "EmptyInput" },
          output: { schema: "EmptyOutput" },
          capabilities: { call: ["trellis.health.read"] },
        },
      },
    },
  } satisfies { digest: string; contract: TrellisContractV1 };
  const healthApp = {
    digest: "health-app-digest",
    contract: {
      format: "trellis.contract.v1",
      id: "health-app@v1",
      displayName: "Health App",
      description: "Reads Trellis health.",
      kind: "app",
      uses: {
        core: {
          contract: "trellis.core@v1",
          rpc: { call: ["Trellis.Health"] },
        },
      },
    },
  } satisfies { digest: string; contract: TrellisContractV1 };

  withContracts([...TEST_CONTRACTS, newerCore, healthApp], () => {
    const publishSubjects = getUserPublishSubjects(
      ["trellis.health.read"],
      { contractDigest: "health-app-digest" },
    );

    assertEquals(publishSubjects.includes("rpc.v1.Trellis.Health"), true);
  });
});

Deno.test("user uses resolution rejects duplicate active surface capability divergence", () => {
  const stricterGraph = {
    digest: "graph-stricter-digest",
    contract: {
      ...TEST_CONTRACTS[2].contract,
      rpc: {
        "Partner.List": {
          version: "v1" as const,
          subject: "rpc.v1.Partner.List",
          input: { schema: "EmptyInput" },
          output: { schema: "EmptyOutput" },
          transfer: { direction: "receive" },
          capabilities: { call: ["partners:read", "partners:sensitive"] },
        },
      },
    },
  } satisfies { digest: string; contract: TrellisContractV1 };

  assertThrows(
    () => {
      withContracts([...TEST_CONTRACTS, stricterGraph], () => {
        getUserPublishSubjects(["partners:read", "partners:sensitive"], {
          contractDigest: "portal-digest",
        });
      });
    },
    Error,
    "Active compatible digests define 'Partner.List' with different capabilities",
  );
});

Deno.test("user uses resolution rejects divergent duplicate active surfaces", () => {
  const divergentGraph = {
    digest: "graph-divergent-digest",
    contract: {
      ...TEST_CONTRACTS[2].contract,
      schemas: {
        ...TEST_CONTRACTS[2].contract.schemas,
        OtherOutput: { type: "string" },
      },
      rpc: {
        "Partner.List": {
          version: "v1" as const,
          subject: "rpc.v1.Partner.List",
          input: { schema: "EmptyInput" },
          output: { schema: "OtherOutput" },
          transfer: { direction: "receive" },
          capabilities: { call: ["partners:read"] },
        },
      },
    },
  } satisfies { digest: string; contract: TrellisContractV1 };

  assertThrows(
    () => {
      withContracts([...TEST_CONTRACTS, divergentGraph], () => {
        getUserPublishSubjects(["partners:read"], {
          contractDigest: "portal-digest",
        });
      });
    },
    Error,
    "Active compatible digests define 'Partner.List' with incompatible output",
  );
});

Deno.test("service permissions include owned RPCs and declared dependencies", () => {
  withContracts(TEST_CONTRACTS, () => {
    const publishSubjects = getServicePublishSubjects(
      [
        "service",
        "jobs.publish",
        "trellis.catalog.read",
        "service:events:auth",
        "billing.refund",
        "billing.read",
      ],
      {
        sessionKey: "graph-key",
        contractDigest: "graph-digest",
      },
    );
    const subscribeSubjects = getServiceSubscribeSubjects(
      ["service", "jobs.subscribe", "service:events:auth"],
      {
        sessionKey: "graph-key",
        contractDigest: "graph-digest",
      },
    );

    assertEquals(publishSubjects.includes("rpc.v1.Trellis.Catalog"), true);
    assertEquals(
      publishSubjects.includes("operations.v1.Billing.Refund"),
      true,
    );
    assertEquals(
      publishSubjects.includes("operations.v1.Billing.Refund.control"),
      true,
    );
    assertEquals(
      publishSubjects.includes(
        "$JS.API.STREAM.INFO.KV_trellis_operations_graph-key",
      ),
      true,
    );
    assertEquals(publishSubjects.includes("$JS.API.INFO"), true);
    // Operation stores are still created lazily by the service runtime client.
    assertEquals(
      publishSubjects.includes(
        "$JS.API.STREAM.CREATE.KV_trellis_operations_graph-key",
      ),
      true,
    );
    assertEquals(subscribeSubjects.includes("rpc.v1.Partner.List"), true);
    assertEquals(
      subscribeSubjects.includes("operations.v1.Partner.Sync"),
      true,
    );
    assertEquals(
      subscribeSubjects.includes("operations.v1.Partner.Sync.control"),
      true,
    );
    assertEquals(subscribeSubjects.includes("events.v1.Auth.Connect"), true);
    assertEquals(
      subscribeSubjects.includes("transfer.v1.upload.graph-key.*"),
      true,
    );
    assertEquals(
      subscribeSubjects.includes("transfer.v1.download.graph-key.*"),
      true,
    );
  });
});

Deno.test("operation control publish uses read, call-defaulted read, and cancel capabilities", () => {
  withContracts(TEST_CONTRACTS, () => {
    const caller = { contractDigest: "portal-digest" };

    const callOnly = getUserPublishSubjects(["partners:write"], caller);
    assertEquals(callOnly.includes("operations.v1.Partner.Sync"), true);
    assertEquals(
      callOnly.includes("operations.v1.Partner.Sync.control"),
      false,
    );

    const readOnly = getUserPublishSubjects(["partners:read"], caller);
    assertEquals(readOnly.includes("operations.v1.Partner.Sync"), false);
    assertEquals(readOnly.includes("operations.v1.Partner.Sync.control"), true);

    const graphCallOnly = getServicePublishSubjects([
      "service",
      "billing.refund",
    ], {
      sessionKey: "graph-key",
      contractDigest: "graph-digest",
    });
    assertEquals(graphCallOnly.includes("operations.v1.Billing.Refund"), true);
    assertEquals(
      graphCallOnly.includes("operations.v1.Billing.Refund.control"),
      false,
    );

    const graphCancelOnly = getServicePublishSubjects([
      "service",
      "billing.cancel",
    ], {
      sessionKey: "graph-key",
      contractDigest: "graph-digest",
    });
    assertEquals(
      graphCancelOnly.includes("operations.v1.Billing.Refund"),
      false,
    );
    assertEquals(
      graphCancelOnly.includes("operations.v1.Billing.Refund.control"),
      true,
    );
  });
});

Deno.test("operation control publish honors empty capability lists and declared cancel", () => {
  const worker = {
    digest: "worker-digest",
    contract: {
      format: "trellis.contract.v1",
      id: "worker@v1",
      displayName: "Worker",
      description: "Uses open operations.",
      kind: "app",
      uses: {
        jobs: {
          contract: "jobs@v1",
          operations: { call: ["Open.Run", "Open.Stop", "Open.CallDefault"] },
        },
      },
    },
  } satisfies { digest: string; contract: TrellisContractV1 };
  const jobs = {
    digest: "jobs-digest",
    contract: {
      format: "trellis.contract.v1",
      id: "jobs@v1",
      displayName: "Jobs",
      description: "Open job operations.",
      kind: "service",
      schemas: {
        Empty: { type: "object" },
      },
      operations: {
        "Open.Run": {
          version: "v1" as const,
          subject: "operations.v1.Open.Run",
          input: { schema: "Empty" },
          output: { schema: "Empty" },
          capabilities: { call: [], read: [] },
        },
        "Open.Stop": {
          version: "v1" as const,
          subject: "operations.v1.Open.Stop",
          input: { schema: "Empty" },
          output: { schema: "Empty" },
          cancel: true,
          capabilities: { call: [], cancel: [] },
        },
        "Open.CallDefault": {
          version: "v1" as const,
          subject: "operations.v1.Open.CallDefault",
          input: { schema: "Empty" },
          output: { schema: "Empty" },
          capabilities: { call: ["open.call"] },
        },
      },
    },
  } satisfies { digest: string; contract: TrellisContractV1 };

  withContracts([...TEST_CONTRACTS, worker, jobs], () => {
    const publishSubjects = getUserPublishSubjects([], {
      contractDigest: "worker-digest",
    });

    assertEquals(publishSubjects.includes("operations.v1.Open.Run"), true);
    assertEquals(
      publishSubjects.includes("operations.v1.Open.Run.control"),
      true,
    );
    assertEquals(publishSubjects.includes("operations.v1.Open.Stop"), true);
    assertEquals(
      publishSubjects.includes("operations.v1.Open.Stop.control"),
      true,
    );
    const callDefaultSubjects = getUserPublishSubjects(["open.call"], {
      contractDigest: "worker-digest",
    });
    assertEquals(
      callDefaultSubjects.includes("operations.v1.Open.CallDefault.control"),
      true,
    );
  });
});

Deno.test("service event subscriptions include JetStream control subjects", () => {
  withContracts(TEST_CONTRACTS, () => {
    const publishSubjects = getServicePublishSubjects(
      ["service", "service:events:auth"],
      {
        sessionKey: "graph-key",
        contractDigest: "graph-digest",
      },
    );

    assertEquals(publishSubjects.includes("$JS.API.INFO"), true);
    assertEquals(
      publishSubjects.includes("$JS.API.CONSUMER.CREATE.trellis.>"),
      false,
    );
    assertEquals(
      publishSubjects.includes("$JS.API.CONSUMER.DURABLE.CREATE.trellis.>"),
      true,
    );
    assertEquals(
      publishSubjects.includes("$JS.API.CONSUMER.INFO.trellis.>"),
      true,
    );
    assertEquals(
      publishSubjects.includes("$JS.API.CONSUMER.MSG.NEXT.trellis.>"),
      true,
    );
    assertEquals(publishSubjects.includes("$JS.ACK.>"), true);
  });
});

Deno.test("service cannot call undeclared cross-contract RPCs by capability alone", () => {
  withContracts(TEST_CONTRACTS, () => {
    const publishSubjects = getServicePublishSubjects(
      ["service", "trellis.catalog.read", "trellis.contract.read"],
      {
        sessionKey: "graph-key",
        contractDigest: "graph-digest",
      },
    );

    assertEquals(publishSubjects.includes("rpc.v1.Trellis.Catalog"), true);
    assertEquals(
      publishSubjects.includes("rpc.v1.Trellis.Contract.Get"),
      false,
    );
  });
});

Deno.test("service deployment named trellis does not implement Trellis-owned contracts", () => {
  withContracts(TEST_CONTRACTS, () => {
    const nonTrellisServiceNamedTrellis = {
      sessionKey: "non-trellis-service-key",
      contractDigest: "graph-digest",
      displayName: "trellis",
    };
    const publishSubjects = getServicePublishSubjects(
      ["service", "trellis.catalog.read", "service:events:auth"],
      nonTrellisServiceNamedTrellis,
    );
    const subscribeSubjects = getServiceSubscribeSubjects(
      ["service", "service:events:auth"],
      nonTrellisServiceNamedTrellis,
    );

    assertEquals(publishSubjects.includes("rpc.v1.Trellis.Catalog"), true);
    assertEquals(subscribeSubjects.includes("rpc.v1.Trellis.Catalog"), false);
    assertEquals(subscribeSubjects.includes("events.v1.Auth.Connect"), true);
  });
});
