import { Hono } from "@hono/hono";
import { assertEquals } from "@std/assert";
import {
  deriveDeviceIdentity,
  signDeviceWaitRequest,
} from "@qlever-llc/trellis/auth";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";

import { createTestContracts } from "../../catalog/test_contracts.ts";
import { analyzeContractProposal } from "../contract_proposal_analysis.ts";
import { computeAuthorityNeedsDelta } from "../authority_needs_decision.ts";
import type {
  AuthorityNeedSet,
  DeploymentAuthority,
  DeploymentAuthorityMaterialization,
  DeploymentAuthorityPlan,
} from "../schemas.ts";
import {
  createDeviceConnectInfoHandler,
  verifyDeviceConnectInfoIdentityProof,
} from "./device.ts";

const TEST_IAT = 1_700_000_000;
const TEST_ROOT_SECRET = new Uint8Array(32).fill(7);
const TEST_INVALID_PUBLIC_IDENTITY_KEY = "A".repeat(43);
const TEST_NOW = "2026-01-01T00:00:00.000Z";

const EMPTY_BOUNDARY: AuthorityNeedSet = {
  contracts: [],
  surfaces: [],
  capabilities: [],
  resources: [],
};

function emptyMaterializedGrants(): DeploymentAuthorityMaterialization[
  "grants"
] {
  return { capabilities: [], surfaces: [], nats: [] };
}

function mergeBoundaries(...boundaries: AuthorityNeedSet[]): AuthorityNeedSet {
  return computeAuthorityNeedsDelta(EMPTY_BOUNDARY, {
    contracts: boundaries.flatMap((boundary) => boundary.contracts),
    surfaces: boundaries.flatMap((boundary) => boundary.surfaces),
    capabilities: boundaries.flatMap((boundary) => boundary.capabilities),
    resources: boundaries.flatMap((boundary) => boundary.resources),
  });
}

function deviceContract(): TrellisContractV1 {
  return {
    format: "trellis.contract.v1",
    id: "example.device@v1",
    displayName: "Example Device",
    description: "Example device contract",
    kind: "device",
    rpc: {
      "Example.Read": {
        version: "v1",
        subject: "rpc.v1.Example.Read",
        input: { schema: "Empty" },
        output: { schema: "Empty" },
        capabilities: { call: ["example.read"] },
      },
    },
    schemas: {
      Empty: { type: "object" },
    },
  };
}

async function validatedDeviceContract() {
  const contracts = createTestContracts();
  return await contracts.validateContract(deviceContract());
}

async function contractBoundary(
  contracts: ReturnType<typeof createTestContracts>,
  contract: TrellisContractV1,
): Promise<AuthorityNeedSet> {
  const analysis = await analyzeContractProposal(contracts, contract);
  return mergeBoundaries(analysis.required, analysis.contributedAvailability);
}

async function createApp(args: {
  instance?: {
    instanceId: string;
    publicIdentityKey: string;
    deploymentId: string;
    state: "registered" | "activated" | "revoked" | "disabled";
    createdAt: string | Date;
    activatedAt: string | Date | null;
    revokedAt: string | Date | null;
  } | null;
  activation?: {
    instanceId: string;
    publicIdentityKey: string;
    deploymentId: string;
    state: "activated" | "revoked";
    activatedAt: string;
    revokedAt: string | null;
  } | null;
  deployment?: {
    deploymentId: string;
    disabled: boolean;
    reviewMode?: "none" | "required";
  } | null;
  contracts?: ReturnType<typeof createTestContracts>;
  authority?: DeploymentAuthority | null;
  materializedAuthority?: DeploymentAuthorityMaterialization | null;
  plans?: DeploymentAuthorityPlan[];
  skipKnownContracts?: boolean;
  nowSeconds?: number;
}) {
  const validated = await validatedDeviceContract();
  const contracts = args.contracts ?? createTestContracts();
  if (!args.skipKnownContracts) {
    contracts.addKnownTestContract({
      digest: validated.digest,
      contract: validated.contract,
    });
    contracts.addKnownTestContract({
      digest: "digest-a",
      contract: validated.contract,
    });
  }
  const authority = args.authority === undefined
    ? {
      deploymentId: "reader.default",
      kind: "device" as const,
      disabled: false,
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
      desiredState: authorityDesiredState(
        await contractBoundary(contracts, validated.contract),
      ),
      version: TEST_NOW,
    }
    : args.authority;
  const materializedAuthority = args.materializedAuthority === undefined
    ? authority === null ? undefined : materializedAuthorityFor(authority)
    : args.materializedAuthority ?? undefined;
  const app = new Hono();
  app.post(
    "/auth/devices/connect-info",
    createDeviceConnectInfoHandler({
      transports: {
        native: { natsServers: ["nats://127.0.0.1:4222"] },
        websocket: { natsServers: ["ws://localhost:8080"] },
      },
      sentinel: { jwt: "jwt", seed: "seed" },
      loadDeviceInstance: async () => args.instance ?? null,
      loadDeviceActivation: async () => args.activation ?? null,
      loadDeviceDeployment: async () => args.deployment ?? null,
      contracts,
      deploymentAuthorityStorage: {
        get: async () => authority ?? undefined,
      },
      deploymentAuthorityPlanStorage: {
        listFiltered: async (filters) =>
          (args.plans ?? []).filter((plan) =>
            (filters.deploymentId === undefined ||
              plan.deploymentId === filters.deploymentId) &&
            (filters.state === undefined || plan.state === filters.state)
          ),
      },
      materializedAuthorityStorage: {
        get: async () => materializedAuthority,
      },
      verifyIdentityProof: verifyDeviceConnectInfoIdentityProof,
      nowSeconds: () => args.nowSeconds ?? TEST_IAT,
    }),
  );
  return app;
}

function materializedAuthorityFor(
  authority: DeploymentAuthority,
  options?: {
    desiredVersion?: string;
    status?: DeploymentAuthorityMaterialization["status"];
    grants?: DeploymentAuthorityMaterialization["grants"];
  },
): DeploymentAuthorityMaterialization {
  const needs = mergeBoundaries(desiredAuthorityNeeds(authority));
  return {
    deploymentId: authority.deploymentId,
    desiredVersion: options?.desiredVersion ?? authority.version,
    status: options?.status ?? "current",
    resourceBindings: [],
    grants: options?.grants ?? {
      capabilities: needs.capabilities.map(({ capability }) => ({
        capability,
      })),
      surfaces: needs.surfaces.map((surface) => ({
        contractId: surface.contractId,
        surfaceKind: surface.kind,
        name: surface.name,
        ...(surface.action === undefined ? {} : { action: surface.action }),
      })),
      nats: [],
    },
    reconciledAt: options?.status === "pending" ? null : TEST_NOW,
    ...(options?.status === "failed" ? { error: "reconciliation failed" } : {}),
  };
}

function desiredAuthorityNeeds(
  authority: DeploymentAuthority,
): AuthorityNeedSet {
  return mergeBoundaries({
    contracts: authority.desiredState.needs.contracts,
    surfaces: [
      ...authority.desiredState.needs.surfaces,
      ...authority.desiredState.surfaces.map((surface) => ({
        ...surface,
        required: true,
      })),
    ],
    capabilities: [
      ...authority.desiredState.capabilities.map((capability) => ({
        capability,
        required: true,
      })),
      ...authority.desiredState.needs.capabilities,
    ],
    resources: [
      ...authority.desiredState.resources,
      ...authority.desiredState.needs.resources,
    ],
  });
}

function authorityDesiredState(
  needs: AuthorityNeedSet,
): DeploymentAuthority["desiredState"] {
  return {
    needs,
    capabilities: needs.capabilities.map((need) => need.capability),
    resources: needs.resources,
    surfaces: needs.surfaces.map(({ required: _required, ...surface }) =>
      surface
    ),
  };
}

async function createAuthorityMiss(): Promise<DeploymentAuthority> {
  return {
    deploymentId: "reader.default",
    kind: "device",
    disabled: false,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    desiredState: authorityDesiredState(EMPTY_BOUNDARY),
    version: TEST_NOW,
  };
}

async function createSignedRequest(contractDigest: string) {
  const identity = await deriveDeviceIdentity(TEST_ROOT_SECRET);
  const signed = await signDeviceWaitRequest({
    flowId: "connect-info",
    publicIdentityKey: identity.publicIdentityKey,
    nonce: "connect-info",
    identitySeed: identity.identitySeed,
    contractDigest,
    iat: TEST_IAT,
  });
  return {
    publicIdentityKey: signed.publicIdentityKey,
    contractDigest: contractDigest,
    iat: signed.iat,
    sig: signed.sig,
  };
}

Deno.test("POST /auth/devices/connect-info returns runtime connect info when device is activated", async () => {
  const request = await createSignedRequest("digest-a");
  const app = await createApp({
    instance: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "activated",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      activatedAt: new Date("2026-01-01T00:01:00.000Z"),
      revokedAt: null,
    },
    activation: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "activated",
      activatedAt: "2026-01-01T00:01:00.000Z",
      revokedAt: null,
    },
    deployment: {
      deploymentId: "reader.default",
      disabled: false,
    },
  });

  const response = await app.request(
    "http://trellis/auth/devices/connect-info",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: "ready",
    connectInfo: {
      instanceId: "dev_1",
      deploymentId: "reader.default",
      contractId: "example.device@v1",
      contractDigest: "digest-a",
      transports: {
        native: { natsServers: ["nats://127.0.0.1:4222"] },
        websocket: { natsServers: ["ws://localhost:8080"] },
      },
      transport: {
        sentinel: { jwt: "jwt", seed: "seed" },
      },
      auth: {
        mode: "device_identity",
        authority: "user_delegated",
        iatSkewSeconds: 30,
      },
    },
  });
});

Deno.test("POST /auth/devices/connect-info resolves accepted proposal contract", async () => {
  const validated = await validatedDeviceContract();
  const request = await createSignedRequest(validated.digest);
  const app = await createApp({
    skipKnownContracts: true,
    plans: [{
      classification: "update",
      planId: "plan-device",
      deploymentId: "reader.default",
      proposal: {
        deploymentId: "reader.default",
        contractId: validated.contract.id,
        contractDigest: validated.digest,
        contract: validated.contract,
        requestedNeeds: EMPTY_BOUNDARY,
        providedSurfaces: [],
        summary: { desiredVersion: TEST_NOW },
      },
      desiredChange: EMPTY_BOUNDARY,
      materializationPreview: {},
      warnings: [],
      createdAt: TEST_NOW,
      state: "accepted",
      decisionAt: TEST_NOW,
      decisionBy: { type: "user" },
      decisionReason: "accepted",
    }],
    instance: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "activated",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      activatedAt: new Date("2026-01-01T00:01:00.000Z"),
      revokedAt: null,
    },
    activation: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "activated",
      activatedAt: "2026-01-01T00:01:00.000Z",
      revokedAt: null,
    },
    deployment: {
      deploymentId: "reader.default",
      disabled: false,
    },
  });

  const response = await app.request(
    "http://trellis/auth/devices/connect-info",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.status, "ready");
  assertEquals(body.connectInfo.contractDigest, validated.digest);
});

Deno.test("POST /auth/devices/connect-info returns device runtime connect info before activation when authority fits", async () => {
  const request = await createSignedRequest("digest-a");
  const app = await createApp({
    instance: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "registered",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      activatedAt: null,
      revokedAt: null,
    },
    activation: null,
    deployment: {
      deploymentId: "reader.default",
      disabled: false,
    },
  });

  const response = await app.request(
    "http://trellis/auth/devices/connect-info",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.status, "ready");
  assertEquals(body.connectInfo.auth.authority, "admin_reviewed");
});

Deno.test("POST /auth/devices/connect-info uses authority fit instead of legacy policies", async () => {
  const request = await createSignedRequest("digest-a");
  const app = await createApp({
    instance: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "registered",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      activatedAt: null,
      revokedAt: null,
    },
    activation: null,
    deployment: {
      deploymentId: "reader.default",
      disabled: false,
    },
  });

  const response = await app.request(
    "http://trellis/auth/devices/connect-info",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.status, "ready");
  assertEquals(body.connectInfo.auth.authority, "admin_reviewed");
});

Deno.test("POST /auth/devices/connect-info does not require materialized contract grants", async () => {
  const request = await createSignedRequest("digest-a");
  const app = await createApp({
    instance: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "activated",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      activatedAt: new Date("2026-01-01T00:01:00.000Z"),
      revokedAt: null,
    },
    activation: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "activated",
      activatedAt: "2026-01-01T00:01:00.000Z",
      revokedAt: null,
    },
    deployment: {
      deploymentId: "reader.default",
      disabled: false,
    },
  });

  const response = await app.request(
    "http://trellis/auth/devices/connect-info",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.status, "ready");
});

Deno.test("POST /auth/devices/connect-info waits for required review activation", async () => {
  const request = await createSignedRequest("digest-a");
  const app = await createApp({
    instance: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "registered",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      activatedAt: null,
      revokedAt: null,
    },
    activation: null,
    deployment: {
      deploymentId: "reader.default",
      disabled: false,
      reviewMode: "required",
    },
  });

  const response = await app.request(
    "http://trellis/auth/devices/connect-info",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  assertEquals(response.status, 404);
  assertEquals(await response.json(), { reason: "unknown_device" });
});

Deno.test("POST /auth/devices/connect-info rejects stale activation deployment", async () => {
  const request = await createSignedRequest("digest-a");
  const app = await createApp({
    instance: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.next",
      state: "activated",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      activatedAt: new Date("2026-01-01T00:01:00.000Z"),
      revokedAt: null,
    },
    activation: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "activated",
      activatedAt: "2026-01-01T00:01:00.000Z",
      revokedAt: null,
    },
    deployment: {
      deploymentId: "reader.default",
      disabled: false,
    },
  });

  const response = await app.request(
    "http://trellis/auth/devices/connect-info",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  assertEquals(response.status, 404);
  assertEquals(await response.json(), { reason: "unknown_device" });
});

Deno.test("POST /auth/devices/connect-info rejects registered device when authority does not fit", async () => {
  const request = await createSignedRequest("digest-a");
  const app = await createApp({
    instance: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "registered",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      activatedAt: null,
      revokedAt: null,
    },
    activation: null,
    deployment: {
      deploymentId: "reader.default",
      disabled: false,
    },
    authority: await createAuthorityMiss(),
  });

  const response = await app.request(
    "http://trellis/auth/devices/connect-info",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  assertEquals(response.status, 403);
  assertEquals(await response.json(), {
    reason: "authority_needs_not_authorized",
  });
});

Deno.test("POST /auth/devices/connect-info waits when authority materialization is absent stale or pending", async () => {
  const request = await createSignedRequest("digest-a");
  for (
    const materializedAuthority of [
      null,
      {
        deploymentId: "reader.default",
        desiredVersion: "old-version",
        status: "current" as const,
        resourceBindings: [],
        grants: emptyMaterializedGrants(),
        reconciledAt: TEST_NOW,
      },
      {
        deploymentId: "reader.default",
        desiredVersion: TEST_NOW,
        status: "pending" as const,
        resourceBindings: [],
        grants: emptyMaterializedGrants(),
        reconciledAt: null,
      },
    ]
  ) {
    const app = await createApp({
      instance: {
        instanceId: "dev_1",
        publicIdentityKey: request.publicIdentityKey,
        deploymentId: "reader.default",
        state: "activated",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        activatedAt: new Date("2026-01-01T00:01:00.000Z"),
        revokedAt: null,
      },
      activation: {
        instanceId: "dev_1",
        publicIdentityKey: request.publicIdentityKey,
        deploymentId: "reader.default",
        state: "activated",
        activatedAt: "2026-01-01T00:01:00.000Z",
        revokedAt: null,
      },
      deployment: {
        deploymentId: "reader.default",
        disabled: false,
      },
      materializedAuthority,
    });

    const response = await app.request(
      "http://trellis/auth/devices/connect-info",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
    );

    assertEquals(response.status, 202);
    assertEquals(await response.json(), {
      reason: "authority_reconciliation_pending",
    });
  }
});

Deno.test("POST /auth/devices/connect-info reports failed authority reconciliation", async () => {
  const request = await createSignedRequest("digest-a");
  const app = await createApp({
    instance: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "activated",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      activatedAt: new Date("2026-01-01T00:01:00.000Z"),
      revokedAt: null,
    },
    activation: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "activated",
      activatedAt: "2026-01-01T00:01:00.000Z",
      revokedAt: null,
    },
    deployment: {
      deploymentId: "reader.default",
      disabled: false,
    },
    materializedAuthority: {
      deploymentId: "reader.default",
      desiredVersion: TEST_NOW,
      status: "failed",
      resourceBindings: [],
      grants: emptyMaterializedGrants(),
      reconciledAt: TEST_NOW,
      error: "provisioning failed",
    },
  });

  const response = await app.request(
    "http://trellis/auth/devices/connect-info",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  assertEquals(response.status, 202);
  assertEquals(await response.json(), {
    reason: "authority_reconciliation_failed",
  });
});

Deno.test("POST /auth/devices/connect-info rejects needs missing from current materialized authority", async () => {
  const request = await createSignedRequest("digest-a");
  const app = await createApp({
    instance: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "activated",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      activatedAt: new Date("2026-01-01T00:01:00.000Z"),
      revokedAt: null,
    },
    activation: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "activated",
      activatedAt: "2026-01-01T00:01:00.000Z",
      revokedAt: null,
    },
    deployment: {
      deploymentId: "reader.default",
      disabled: false,
    },
    materializedAuthority: {
      deploymentId: "reader.default",
      desiredVersion: TEST_NOW,
      status: "current",
      resourceBindings: [],
      grants: emptyMaterializedGrants(),
      reconciledAt: TEST_NOW,
    },
  });

  const response = await app.request(
    "http://trellis/auth/devices/connect-info",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  assertEquals(response.status, 403);
  assertEquals(await response.json(), {
    reason: "authority_needs_not_materialized",
  });
});

Deno.test("POST /auth/devices/connect-info rejects disabled registered devices", async () => {
  const request = await createSignedRequest("digest-a");
  const app = await createApp({
    instance: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "disabled",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      activatedAt: null,
      revokedAt: null,
    },
    activation: null,
    deployment: {
      deploymentId: "reader.default",
      disabled: false,
    },
  });

  const response = await app.request(
    "http://trellis/auth/devices/connect-info",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  assertEquals(response.status, 404);
  assertEquals(await response.json(), { reason: "unknown_device" });
});

Deno.test("POST /auth/devices/connect-info returns 404 for revoked activations", async () => {
  const request = await createSignedRequest("digest-a");
  const app = await createApp({
    instance: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "revoked",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      activatedAt: new Date("2026-01-01T00:01:00.000Z"),
      revokedAt: new Date("2026-01-01T00:02:00.000Z"),
    },
    activation: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "revoked",
      activatedAt: "2026-01-01T00:01:00.000Z",
      revokedAt: "2026-01-01T00:02:00.000Z",
    },
    deployment: {
      deploymentId: "reader.default",
      disabled: false,
    },
  });

  const response = await app.request(
    "http://trellis/auth/devices/connect-info",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  assertEquals(response.status, 404);
  assertEquals(await response.json(), { reason: "unknown_device" });
});

Deno.test("POST /auth/devices/connect-info rejects invalid signatures", async () => {
  const request = await createSignedRequest("digest-a");
  const app = await createApp({
    instance: null,
    activation: null,
    deployment: null,
  });

  const response = await app.request(
    "http://trellis/auth/devices/connect-info",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...request,
        contractDigest: "digest-b",
      }),
    },
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { reason: "invalid_signature" });
});

Deno.test("POST /auth/devices/connect-info returns serverNow when proof iat is out of range", async () => {
  const request = await createSignedRequest("digest-a");
  const app = await createApp({
    instance: null,
    activation: null,
    deployment: null,
    nowSeconds: TEST_IAT + 31,
  });

  const response = await app.request(
    "http://trellis/auth/devices/connect-info",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    reason: "iat_out_of_range",
    serverNow: TEST_IAT + 31,
  });
});
