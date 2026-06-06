import { assertEquals } from "@std/assert";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";

import type { ImplementationOffer } from "./schemas.ts";
import { __testing__ } from "./register.ts";

const TEST_NOW = "2026-06-06T00:00:00.000Z";

function offer(
  overrides: Partial<ImplementationOffer> = {},
): ImplementationOffer {
  return {
    offerId: "offer_1",
    deploymentKind: "service",
    deploymentId: "svc_1",
    instanceId: "svc_1_a",
    contractId: "trellis.integration-harness.catalog-authority@v1",
    contractDigest: "provider-digest",
    lineageKey: JSON.stringify([
      "service",
      "svc_1",
      "trellis.integration-harness.catalog-authority@v1",
    ]),
    status: "accepted",
    liveness: "healthy",
    firstOfferedAt: TEST_NOW,
    acceptedAt: TEST_NOW,
    lastRefreshedAt: TEST_NOW,
    staleAt: null,
    expiresAt: null,
    ...overrides,
  };
}

const providerContract: TrellisContractV1 = {
  format: "trellis.contract.v1",
  id: "trellis.integration-harness.catalog-authority@v1",
  displayName: "Catalog Authority Harness",
  description: "Harness service contract.",
  kind: "service",
  schemas: { Empty: { type: "object" } },
  rpc: {
    "Authority.Ping": {
      version: "v1",
      subject: "rpc.v1.Harness.CatalogAuthority.Ping",
      input: { schema: "Empty" },
      output: { schema: "Empty" },
    },
  },
};

const authContract: TrellisContractV1 = {
  format: "trellis.contract.v1",
  id: "trellis.auth@v1",
  displayName: "Auth",
  description: "Auth platform contract.",
  kind: "service",
  schemas: { Empty: { type: "object" } },
  rpc: {
    "Auth.Sessions.Me": {
      version: "v1",
      subject: "rpc.v1.Auth.Sessions.Me",
      input: { schema: "Empty" },
      output: { schema: "Empty" },
    },
  },
};

const coreContract: TrellisContractV1 = {
  format: "trellis.contract.v1",
  id: "trellis.core@v1",
  displayName: "Core",
  description: "Core platform contract.",
  kind: "service",
  schemas: { Empty: { type: "object" } },
  rpc: {
    "Trellis.Bindings.Get": {
      version: "v1",
      subject: "rpc.v1.Trellis.Bindings.Get",
      input: { schema: "Empty" },
      output: { schema: "Empty" },
    },
  },
};

const dependencyContract: TrellisContractV1 = {
  format: "trellis.contract.v1",
  id: "trellis.integration-harness.dependency@v1",
  displayName: "Dependency",
  description: "Dependency service contract.",
  kind: "service",
  schemas: { Empty: { type: "object" } },
  rpc: {
    "Dependency.Ping": {
      version: "v1",
      subject: "rpc.v1.Dependency.Ping",
      input: { schema: "Empty" },
      output: { schema: "Empty" },
    },
  },
};

const requiredDepV1Contract: TrellisContractV1 = {
  format: "trellis.contract.v1",
  id: "trellis.integration-harness.required-dep@v1",
  displayName: "Required Dependency",
  description: "Required dependency service contract.",
  kind: "service",
  schemas: { Empty: { type: "object" } },
  rpc: {
    "Required.Dep.Ping": {
      version: "v1",
      subject: "rpc.v1.Required.Dep.Ping",
      input: { schema: "Empty" },
      output: { schema: "Empty" },
    },
  },
};

const requiredDepV2Contract: TrellisContractV1 = {
  ...requiredDepV1Contract,
  rpc: {
    ...requiredDepV1Contract.rpc,
    "Required.Dep.Pong": {
      version: "v1",
      subject: "rpc.v1.Required.Dep.Pong",
      input: { schema: "Empty" },
      output: { schema: "Empty" },
    },
  },
};

const transferContract: TrellisContractV1 = {
  format: "trellis.contract.v1",
  id: "trellis.integration-harness.transfer@v1",
  displayName: "Transfer Harness",
  description: "Transfer service contract.",
  kind: "service",
  schemas: { Empty: { type: "object" } },
  rpc: {
    "Transfer.Download": {
      version: "v1",
      subject: "rpc.v1.Transfer.Download",
      input: { schema: "Empty" },
      output: { schema: "Empty" },
      transfer: { direction: "receive" },
    },
  },
  operations: {
    "Transfer.Upload": {
      version: "v1",
      subject: "operations.v1.Transfer.Upload",
      input: { schema: "Empty" },
      output: { schema: "Empty" },
      transfer: { direction: "send", store: "uploads", key: "/key" },
    },
  },
};

const jobsContract: TrellisContractV1 = {
  format: "trellis.contract.v1",
  id: "trellis.jobs@v1",
  displayName: "Trellis Jobs",
  description: "Jobs service contract.",
  kind: "service",
  schemas: { Empty: { type: "object" } },
  rpc: {
    "Jobs.Health": {
      version: "v1",
      subject: "rpc.v1.Jobs.Health",
      input: { schema: "Empty" },
      output: { schema: "Empty" },
    },
  },
};

Deno.test("accepted-offer NATS materializer keeps trellis-prefixed providers owned", async () => {
  const contracts = new Map([
    [providerContract.id, providerContract],
    [authContract.id, authContract],
    [coreContract.id, coreContract],
    [dependencyContract.id, dependencyContract],
  ]);

  const grants = await __testing__.materializeAcceptedOfferNatsGrants({
    authority: {
      deploymentId: "svc_1",
      kind: "service",
      disabled: false,
      version: "authority_v1",
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
      desiredState: {
        capabilities: [],
        resources: [],
        needs: [{
          kind: "surface",
          surface: {
            contractId: dependencyContract.id,
            kind: "rpc",
            name: "Dependency.Ping",
            action: "call",
          },
          required: false,
        }],
        surfaces: [
          {
            contractId: providerContract.id,
            kind: "rpc",
            name: "Authority.Ping",
            action: "call",
          },
          {
            contractId: authContract.id,
            kind: "rpc",
            name: "Auth.Sessions.Me",
            action: "call",
          },
          {
            contractId: dependencyContract.id,
            kind: "rpc",
            name: "Dependency.Ping",
            action: "call",
          },
        ],
      },
    },
    contracts: {
      getKnownContract: async (digest) =>
        digest === "provider-digest" ? providerContract : undefined,
      getKnownContractsById: async (contractId) => {
        const contract = contracts.get(contractId);
        return contract ? [contract] : [];
      },
    },
    implementationOfferStorage: {
      listByDeployment: async () => [offer()],
    },
  });

  assertEquals(
    grants.map((grant) => ({
      direction: grant.direction,
      subject: grant.subject,
      grantSource: grant.grantSource,
    })),
    [
      {
        direction: "publish",
        subject: "rpc.v1.Auth.Sessions.Me",
        grantSource: "platform-service",
      },
      {
        direction: "publish",
        subject: "rpc.v1.Dependency.Ping",
        grantSource: "used-surface",
      },
      {
        direction: "publish",
        subject: "rpc.v1.Trellis.Bindings.Get",
        grantSource: "platform-service",
      },
      {
        direction: "subscribe",
        subject: "rpc.v1.Harness.CatalogAuthority.Ping",
        grantSource: "owned-surface",
      },
    ],
  );
});

Deno.test("accepted-offer NATS materializer uses latest accepted contract digest", async () => {
  const newerAcceptedAt = "2026-06-06T00:01:00.000Z";
  const grants = await __testing__.materializeAcceptedOfferNatsGrants({
    authority: {
      deploymentId: "svc_1",
      kind: "service",
      disabled: false,
      version: "authority_v1",
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
      desiredState: {
        capabilities: [],
        resources: [],
        needs: [],
        surfaces: [
          {
            contractId: requiredDepV2Contract.id,
            kind: "rpc",
            name: "Required.Dep.Ping",
            action: "call",
          },
          {
            contractId: requiredDepV2Contract.id,
            kind: "rpc",
            name: "Required.Dep.Pong",
            action: "call",
          },
        ],
      },
    },
    contracts: {
      getKnownContract: async (digest) =>
        digest === "required-dep-v2"
          ? requiredDepV2Contract
          : digest === "required-dep-v1"
          ? requiredDepV1Contract
          : undefined,
      getKnownContractsById: async () => [requiredDepV1Contract],
    },
    implementationOfferStorage: {
      listByDeployment: async () => [
        offer({
          offerId: "offer_new",
          contractId: requiredDepV2Contract.id,
          contractDigest: "required-dep-v2",
          lineageKey: JSON.stringify([
            "service",
            "svc_1",
            requiredDepV2Contract.id,
          ]),
          acceptedAt: newerAcceptedAt,
          lastRefreshedAt: newerAcceptedAt,
        }),
        offer({
          offerId: "offer_old",
          contractId: requiredDepV1Contract.id,
          contractDigest: "required-dep-v1",
          lineageKey: JSON.stringify([
            "service",
            "svc_1",
            requiredDepV1Contract.id,
          ]),
        }),
      ],
    },
  });

  assertEquals(
    grants.filter((grant) => grant.grantSource === "owned-surface").map((
      grant,
    ) => grant.subject),
    ["rpc.v1.Required.Dep.Ping", "rpc.v1.Required.Dep.Pong"],
  );
});

Deno.test("accepted-offer NATS materializer adds service transfer endpoint grants", async () => {
  const grants = await __testing__.materializeAcceptedOfferNatsGrants({
    authority: {
      deploymentId: "svc_1",
      kind: "service",
      disabled: false,
      version: "authority_v1",
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
      desiredState: {
        capabilities: [],
        resources: [],
        needs: [],
        surfaces: [
          {
            contractId: transferContract.id,
            kind: "operation",
            name: "Transfer.Upload",
            action: "call",
          },
          {
            contractId: transferContract.id,
            kind: "rpc",
            name: "Transfer.Download",
            action: "call",
          },
        ],
      },
    },
    contracts: {
      getKnownContract: async (digest) =>
        digest === "transfer-digest" ? transferContract : undefined,
      getKnownContractsById: async () => [],
    },
    implementationOfferStorage: {
      listByDeployment: async () => [offer({
        contractId: transferContract.id,
        contractDigest: "transfer-digest",
        lineageKey: JSON.stringify([
          "service",
          "svc_1",
          transferContract.id,
        ]),
      })],
    },
  });

  assertEquals(
    grants.filter((grant) => grant.grantSource === "transfer").map((grant) =>
      grant.subject
    ),
    [
      "transfer.v1.download.{serviceSessionPrefix}.*",
      "transfer.v1.upload.{serviceSessionPrefix}.*",
    ],
  );
});

Deno.test("accepted-offer NATS materializer adds Jobs runtime grants", async () => {
  const grants = await __testing__.materializeAcceptedOfferNatsGrants({
    authority: {
      deploymentId: "jobs",
      kind: "service",
      disabled: false,
      version: "authority_v1",
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
      desiredState: {
        capabilities: [],
        resources: [],
        needs: [],
        surfaces: [{
          contractId: jobsContract.id,
          kind: "rpc",
          name: "Jobs.Health",
          action: "call",
        }],
      },
    },
    contracts: {
      getKnownContract: async (digest) =>
        digest === "jobs-digest" ? jobsContract : undefined,
      getKnownContractsById: async () => [],
    },
    implementationOfferStorage: {
      listByDeployment: async () => [offer({
        deploymentId: "jobs",
        contractId: jobsContract.id,
        contractDigest: "jobs-digest",
        lineageKey: JSON.stringify(["service", "jobs", jobsContract.id]),
      })],
    },
  });
  const jobsRuntimeSubjects = grants
    .filter((grant) => grant.grantSource === "platform-service")
    .map((grant) => grant.subject);

  assertEquals(
    [
      "$JS.API.STREAM.INFO.JOBS_ADVISORIES",
      "$JS.API.CONSUMER.DURABLE.CREATE.JOBS_ADVISORIES.>",
      "$JS.API.STREAM.MSG.GET.JOBS_WORK",
    ].every((subject) => jobsRuntimeSubjects.includes(subject)),
    true,
  );
  assertEquals(
    jobsRuntimeSubjects.some((subject) =>
      subject.includes("JOBS_WORKER_PRESENCE")
    ),
    true,
  );
});

Deno.test("accepted-offer NATS materializer finds used surfaces in later known digests", async () => {
  const grants = await __testing__.materializeAcceptedOfferNatsGrants({
    authority: {
      deploymentId: "svc_1",
      kind: "service",
      disabled: false,
      version: "authority_v1",
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
      desiredState: {
        capabilities: [],
        resources: [],
        needs: [{
          kind: "surface",
          surface: {
            contractId: requiredDepV2Contract.id,
            kind: "rpc",
            name: "Required.Dep.Pong",
            action: "call",
          },
          required: true,
        }],
        surfaces: [],
      },
    },
    contracts: {
      getKnownContract: async () => undefined,
      getKnownContractsById: async (contractId) =>
        contractId === requiredDepV2Contract.id
          ? [requiredDepV1Contract, requiredDepV2Contract]
          : contractId === coreContract.id
          ? [coreContract]
          : [],
    },
    implementationOfferStorage: {
      listByDeployment: async () => [],
    },
  });

  assertEquals(
    grants.filter((grant) => grant.grantSource === "used-surface").map((
      grant,
    ) => grant.subject),
    ["rpc.v1.Required.Dep.Pong"],
  );
});
