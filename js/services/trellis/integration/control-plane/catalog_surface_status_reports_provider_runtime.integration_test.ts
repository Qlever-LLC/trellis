import { assert, assertEquals, assertInstanceOf } from "@std/assert";
import {
  type ClientAuthContinuation,
  type ClientAuthRequiredContext,
  type ConnectedTrellisClient,
  defineAppContract,
  defineServiceContract,
  isErr,
  Result,
  TrellisClient,
  ValidationError,
} from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import { sdk as trellisCore } from "@qlever-llc/trellis/sdk/core.ts";
import type {
  TrellisSurfaceStatusInput,
  TrellisSurfaceStatusOutput,
} from "@qlever-llc/trellis/sdk/core.ts";
import { Type } from "typebox";
import {
  caseScopedContractId,
  caseScopedName,
  caseScopedSubject,
} from "@qlever-llc/trellis-test/integration";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";

const CASE_ID =
  "control-plane.catalog-surface-status-reports-provider-runtime" as const;

const schemas = {
  PingInput: Type.Object({ message: Type.String() }),
  PingOutput: Type.Object({ message: Type.String(), servedBy: Type.String() }),
  Progress: Type.Object({ message: Type.String() }),
  PublicValue: Type.Object({}),
} as const;

const providerContractId = caseScopedContractId(
  "trellis.integration.control-plane.catalog-surface-status-provider",
  CASE_ID,
);
const providerLocalCapability = "ping";
const providerCapability = providerContractId.replace(/@v1$/, "") + "::ping";
const providerPublishLocalCapability = "publishStatus";
const providerReadFeedLocalCapability = "readStatusFeed";

const providerContractDocs = {
  summary: "Catalog surface status provider.",
  markdown: "Documents the provider contract used by live catalog tests.",
} as const;
const providerRpcDocs = {
  summary: "Ping catalog surface status.",
  markdown: "Returns a live response from the provider runtime.",
} as const;
const providerOperationDocs = {
  markdown: "Imports catalog surface status values asynchronously.",
} as const;
const providerEventDocs = {
  markdown: "Published when catalog surface status values change.",
} as const;

const providerContract = defineServiceContract({ schemas }, (ref) => ({
  id: providerContractId,
  displayName: "Trellis Control-Plane Catalog Surface Status Provider",
  description:
    "Provides an RPC used to prove Surface.Status reports provider runtime state.",
  docs: providerContractDocs,
  capabilities: {
    [providerLocalCapability]: {
      displayName: "Call catalog surface status ping",
      description: "Call the Surface.Status runtime probe RPC.",
    },
    [providerPublishLocalCapability]: {
      displayName: "Publish catalog surface status changes",
      description: "Publish Surface.Status runtime probe events.",
    },
    [providerReadFeedLocalCapability]: {
      displayName: "Read catalog surface status feed",
      description: "Subscribe to Surface.Status runtime probe feed frames.",
    },
  },
  exports: { schemas: ["PublicValue"] },
  rpc: {
    "CatalogSurfaceStatus.Ping": {
      version: "v1",
      subject: caseScopedSubject(
        "rpc.v1.integration.control-plane.catalog-surface-status-provider",
        CASE_ID,
        "CatalogSurfaceStatus.Ping",
      ),
      input: ref.schema("PingInput"),
      output: ref.schema("PingOutput"),
      capabilities: { call: [providerLocalCapability] },
      errors: [],
      docs: providerRpcDocs,
    },
  },
  operations: {
    "CatalogSurfaceStatus.Import": {
      version: "v1",
      subject: caseScopedSubject(
        "operations.v1.integration.control-plane.catalog-surface-status-provider",
        CASE_ID,
        "CatalogSurfaceStatus.Import",
      ),
      input: ref.schema("PingInput"),
      progress: ref.schema("Progress"),
      output: ref.schema("PingOutput"),
      capabilities: { call: [providerLocalCapability] },
      docs: providerOperationDocs,
    },
  },
  events: {
    "CatalogSurfaceStatus.Changed": {
      version: "v1",
      subject: caseScopedSubject(
        "events.v1.integration.control-plane.catalog-surface-status-provider",
        CASE_ID,
        "CatalogSurfaceStatus.Changed",
      ),
      event: ref.schema("PublicValue"),
      capabilities: { publish: [providerPublishLocalCapability] },
      docs: providerEventDocs,
    },
  },
  feeds: {
    "CatalogSurfaceStatus.Feed": {
      version: "v1",
      subject: caseScopedSubject(
        "feeds.v1.integration.control-plane.catalog-surface-status-provider",
        CASE_ID,
        "CatalogSurfaceStatus.Feed",
      ),
      input: ref.schema("PingInput"),
      event: ref.schema("PublicValue"),
      capabilities: { subscribe: [providerReadFeedLocalCapability] },
    },
  },
}));

const oldProviderContractWithoutPing = defineServiceContract(
  { schemas },
  (ref) => ({
    id: providerContractId,
    displayName: "Trellis Control-Plane Catalog Surface Status Old Provider",
    description:
      "Provides an older same-id provider digest without the requested ping surface.",
    rpc: {
      "CatalogSurfaceStatus.Legacy": {
        version: "v1",
        subject: caseScopedSubject(
          "rpc.v1.integration.control-plane.catalog-surface-status-provider",
          CASE_ID,
          "CatalogSurfaceStatus.Legacy",
        ),
        input: ref.schema("PingInput"),
        output: ref.schema("PingOutput"),
        errors: [],
      },
    },
  }),
);

const unrelatedContract = defineServiceContract({ schemas }, (ref) => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.catalog-surface-status-unrelated",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Catalog Surface Status Unrelated",
  description: "Provides an unrelated live service for Surface.Status filters.",
  rpc: {
    "CatalogSurfaceStatusUnrelated.Ping": {
      version: "v1",
      subject: caseScopedSubject(
        "rpc.v1.integration.control-plane.catalog-surface-status-unrelated",
        CASE_ID,
        "CatalogSurfaceStatusUnrelated.Ping",
      ),
      input: ref.schema("PingInput"),
      output: ref.schema("PingOutput"),
      errors: [],
    },
  },
}));

const authorizedClientContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.catalog-surface-status-client",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Catalog Surface Status Client",
  description:
    "Calls Trellis.Surface.Status and the provider RPC for runtime status coverage.",
  uses: {
    required: {
      core: trellisCore.use({
        rpc: { call: ["Trellis.Surface.Status", "Trellis.Contract.Get"] },
      }),
      auth: trellisAuth.use({
        rpc: {
          call: [
            "Auth.Connections.Kick",
            "Auth.Connections.List",
            "Auth.ServiceInstances.Disable",
            "Auth.ServiceInstances.List",
            "Auth.Users.Create",
            "Auth.Users.PasswordReset.Create",
          ],
        },
      }),
      provider: providerContract.use({
        rpc: { call: ["CatalogSurfaceStatus.Ping"] },
        events: { publish: ["CatalogSurfaceStatus.Changed"] },
        feeds: { subscribe: ["CatalogSurfaceStatus.Feed"] },
      }),
    },
  },
}));

const observerClientContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.catalog-surface-status-observer",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Catalog Surface Status Observer",
  description: "Calls Trellis.Surface.Status without provider RPC authority.",
  uses: {
    required: {
      core: trellisCore.use({ rpc: { call: ["Trellis.Surface.Status"] } }),
    },
  },
}));

const providerName = caseScopedName("catalog-surface-status-provider", CASE_ID);
const oldProviderName = caseScopedName(
  "catalog-surface-status-old-provider",
  CASE_ID,
);
const unrelatedName = caseScopedName(
  "catalog-surface-status-unrelated",
  CASE_ID,
);
const authorizedClientName = caseScopedName(
  "catalog-surface-status-client",
  CASE_ID,
);
const observerClientName = caseScopedName(
  "catalog-surface-status-observer",
  CASE_ID,
);
const observerUsername = caseScopedName(
  "catalog-surface-status-observer-user",
  CASE_ID,
);
const observerPassword =
  `trellis-integration-${CASE_ID}-observer-password-2026`;
const shapeOnlyDeployment = caseScopedName(
  "catalog-surface-status-shape-only",
  CASE_ID,
);
const oldProviderDeployment = caseScopedName(
  "catalog-surface-status-old-provider",
  CASE_ID,
);

liveTrellisTest({
  name:
    "control-plane.catalog-surface-status-reports-provider-runtime reports provider runtime through Surface.Status",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    await runtime.contracts.approve({
      deployment: shapeOnlyDeployment,
      contract: providerContract,
    });

    const client = await runtime.connectClient({
      name: authorizedClientName,
      contract: authorizedClientContract,
    });

    let service: { stop(): Promise<void> } | undefined;
    let unrelatedService: { stop(): Promise<void> } | undefined;
    let observer:
      | ConnectedTrellisClient<typeof observerClientContract>
      | undefined;
    let oldProviderService: { stop(): Promise<void> } | undefined;
    try {
      await runtime.waitFor(async () => {
        const status = await providerStatus(client);
        return status.state === "unavailable" ? status : false;
      }, { timeoutMs: 15_000, intervalMs: 100 });
      assertEquals(await providerStatus(client), {
        state: "unavailable",
        reason: "authority_unavailable",
      });
      assertEquals(
        await surfaceStatus(client, {
          contractId: "missing@v1",
          kind: "rpc",
          surface: "CatalogSurfaceStatus.Ping",
          action: "call",
        }),
        { state: "unknown_contract", contractId: "missing@v1" },
      );
      assertEquals(
        await surfaceStatus(client, {
          contractId: providerContract.CONTRACT_ID,
          kind: "rpc",
          surface: "CatalogSurfaceStatus.Missing",
          action: "call",
        }),
        {
          state: "unknown_surface",
          contractId: providerContract.CONTRACT_ID,
          kind: "rpc",
          surface: "CatalogSurfaceStatus.Missing",
        },
      );
      await assertSurfaceStatusValidationError(client, {
        contractId: providerContract.CONTRACT_ID,
        kind: "event",
        surface: "CatalogSurfaceStatus.Changed",
      });
      await assertSurfaceStatusValidationError(client, {
        contractId: providerContract.CONTRACT_ID,
        kind: "feed",
        surface: "CatalogSurfaceStatus.Feed",
        action: "publish",
      });
      await assertSurfaceStatusValidationError(client, {
        contractId: providerContract.CONTRACT_ID,
        kind: "rpc",
        surface: "CatalogSurfaceStatus.Ping",
        action: "subscribe",
      });
      await assertSurfaceStatusValidationError(client, {
        contractId: "missing@v1",
        kind: "rpc",
        surface: "CatalogSurfaceStatus.Ping",
        action: "subscribe",
      });

      const providerDigest = providerContract.CONTRACT_DIGEST;
      assert(providerDigest, "provider contract digest should be generated");
      const contractGet = await client.rpc.trellis.contractGet({
        digest: providerDigest,
      }).orThrow();
      assertEquals(contractGet.contract.exports, { schemas: ["PublicValue"] });
      assertEquals(contractGet.contract.docs, providerContractDocs);
      assertEquals(
        requireRecord(contractGet.contract.rpc?.["CatalogSurfaceStatus.Ping"])
          .docs,
        providerRpcDocs,
      );
      assertEquals(
        requireRecord(
          contractGet.contract.operations?.["CatalogSurfaceStatus.Import"],
        ).docs,
        providerOperationDocs,
      );
      assertEquals(
        requireRecord(
          contractGet.contract.events?.["CatalogSurfaceStatus.Changed"],
        ).docs,
        providerEventDocs,
      );

      const providerKey = await runtime.registerService({
        name: providerName,
        contract: providerContract,
      });
      const connectedService = await TrellisService.connect({
        trellisUrl: runtime.trellisUrl,
        contract: providerContract,
        name: providerName,
        sessionKeySeed: providerKey.seed,
        telemetry: false,
        server: { log: false },
      }).orThrow();
      service = connectedService;
      connectedService.handle.rpc.catalogSurfaceStatus.ping(({ input }) =>
        Result.ok({ message: input.message, servedBy: providerName })
      );

      await runtime.waitFor(async () => {
        const status = await providerStatus(client);
        return status.state === "available" && status.liveImplementer === true
          ? status
          : false;
      }, { timeoutMs: 15_000, intervalMs: 100 });
      assertEquals(await providerStatus(client), {
        state: "available",
        liveImplementer: true,
        runtime: "live",
      });
      assertEquals(
        await surfaceStatus(client, {
          contractId: providerContract.CONTRACT_ID,
          kind: "event",
          surface: "CatalogSurfaceStatus.Changed",
          action: "publish",
        }),
        {
          state: "available",
          liveImplementer: true,
          runtime: "live",
        },
      );
      assertEquals(
        await surfaceStatus(client, {
          contractId: providerContract.CONTRACT_ID,
          kind: "feed",
          surface: "CatalogSurfaceStatus.Feed",
          action: "subscribe",
        }),
        {
          state: "available",
          liveImplementer: true,
          runtime: "live",
        },
      );
      const connectedObserver = await connectObserver(
        runtime.trellisUrl,
        client,
      );
      observer = connectedObserver;
      assertEquals(await providerStatus(connectedObserver), {
        state: "unauthorized",
        missingCapabilities: [providerCapability],
      });
      assertEquals(
        await client.rpc.catalogSurfaceStatus.ping({ message: "live" })
          .orThrow(),
        { message: "live", servedBy: providerName },
      );

      const providerUserNkey = await runtime.waitFor(async () => {
        return await connectionUserNkey(client, providerKey.sessionKey) ??
          false;
      }, { timeoutMs: 15_000, intervalMs: 100 });
      assertEquals(
        await client.rpc.auth.connectionsKick({ userNkey: providerUserNkey })
          .orThrow(),
        { success: true },
      );
      await runtime.waitFor(async () => {
        const status = await providerStatus(client);
        return status.state === "available" &&
            status.runtime === "no_live_implementer"
          ? status
          : false;
      }, { timeoutMs: 15_000, intervalMs: 100 });
      assertEquals(await providerStatus(client), {
        state: "available",
        liveImplementer: false,
        runtime: "no_live_implementer",
      });

      const oldProviderKey = await runtime.registerService({
        name: oldProviderName,
        contract: oldProviderContractWithoutPing,
        deployment: oldProviderDeployment,
      });
      oldProviderService = await TrellisService.connect({
        trellisUrl: runtime.trellisUrl,
        contract: oldProviderContractWithoutPing,
        name: oldProviderName,
        sessionKeySeed: oldProviderKey.seed,
        telemetry: false,
        server: { log: false },
      }).orThrow();
      await runtime.waitFor(async () => {
        return await connectionUserNkey(client, oldProviderKey.sessionKey)
          ? true
          : false;
      }, { timeoutMs: 15_000, intervalMs: 100 });
      assertEquals(await providerStatus(client), {
        state: "available",
        liveImplementer: false,
        runtime: "no_live_implementer",
      });

      const unrelatedKey = await runtime.registerService({
        name: unrelatedName,
        contract: unrelatedContract,
      });
      unrelatedService = await TrellisService.connect({
        trellisUrl: runtime.trellisUrl,
        contract: unrelatedContract,
        name: unrelatedName,
        sessionKeySeed: unrelatedKey.seed,
        telemetry: false,
        server: { log: false },
      }).orThrow();
      await runtime.waitFor(async () => {
        return await connectionUserNkey(client, unrelatedKey.sessionKey)
          ? true
          : false;
      }, { timeoutMs: 15_000, intervalMs: 100 });
      assertEquals(await providerStatus(client), {
        state: "available",
        liveImplementer: false,
        runtime: "no_live_implementer",
      });

      const instanceId = await providerInstanceId(
        client,
        providerKey.sessionKey,
      );
      await client.rpc.auth.serviceInstancesDisable({ instanceId }).orThrow();
      await runtime.waitFor(async () => {
        const status = await providerStatus(client);
        return status.state === "available" && status.runtime === "disabled"
          ? status
          : false;
      }, { timeoutMs: 15_000, intervalMs: 100 });
      assertEquals(await providerStatus(client), {
        state: "available",
        liveImplementer: false,
        runtime: "disabled",
      });
    } finally {
      await observer?.connection.close().catch(() => undefined);
      await client.connection.close().catch(() => undefined);
      await oldProviderService?.stop().catch(() => undefined);
      await unrelatedService?.stop().catch(() => undefined);
      await service?.stop().catch(() => undefined);
    }
  },
});

async function connectObserver(
  trellisUrl: string,
  admin: SurfaceStatusAdminClient,
): Promise<ConnectedTrellisClient<typeof observerClientContract>> {
  const created = await createLocalObserverUser(admin);
  await completeLocalPasswordAccountFlow({
    trellisUrl,
    flowId: created.flowId,
    username: observerUsername,
    password: observerPassword,
  });
  const key = randomSessionSeed();
  return await TrellisClient.connect({
    trellisUrl,
    name: observerClientName,
    contract: observerClientContract,
    auth: {
      mode: "session_key",
      sessionKeySeed: key,
      redirectTo: `${trellisUrl}/_trellis/test/catalog-surface-status`,
    },
    onAuthRequired: (ctx) =>
      completeLocalLoginFlow({
        trellisUrl,
        username: observerUsername,
        password: observerPassword,
        ctx,
      }),
  }).orThrow();
}

async function createLocalObserverUser(
  admin: SurfaceStatusAdminClient,
): Promise<{ flowId: string }> {
  const created = await admin.rpc.auth.usersCreate({
    username: observerUsername,
    name: "Catalog Surface Status Observer",
    email: `${observerUsername}@example.test`,
    active: true,
    capabilities: ["trellis.core::catalog.read"],
    capabilityGroups: [],
  }).orThrow();
  return await admin.rpc.auth.usersPasswordResetCreate({
    userId: created.user.userId,
  }).orThrow();
}

async function completeLocalPasswordAccountFlow(args: {
  trellisUrl: string;
  flowId: string;
  username: string;
  password: string;
}): Promise<void> {
  const response = await fetch(
    `${args.trellisUrl}/auth/account-flow/${
      encodeURIComponent(args.flowId)
    }/local-password`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: args.username,
        password: args.password,
      }),
    },
  );
  const body = await response.text();
  assertEquals(response.status, 200, body);
}

async function completeLocalLoginFlow(args: {
  trellisUrl: string;
  username: string;
  password: string;
  ctx: ClientAuthRequiredContext;
}): Promise<ClientAuthContinuation> {
  const flowId = new URL(args.ctx.loginUrl).searchParams.get("flowId");
  assert(flowId, "Trellis auth URL is missing flowId");
  const response = await fetch(`${args.trellisUrl}/auth/login/local`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      flowId,
      username: args.username,
      password: args.password,
    }),
  });
  if (!response.ok) {
    throw new Error(`local login failed (${response.status})`);
  }

  const state = await fetchJson(
    `${args.trellisUrl}/auth/flow/${encodeURIComponent(flowId)}`,
  );
  assert(isRecord(state), "expected portal flow state response object");
  if (state.status === "approval_required") {
    const approved = await fetchJson(
      `${args.trellisUrl}/auth/flow/${encodeURIComponent(flowId)}/approval`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: true }),
      },
    );
    assert(isRecord(approved), "expected portal approval response object");
    assertEquals(approved.status, "redirect");
  } else {
    assertEquals(state.status, "redirect");
  }

  return { status: "bound", flowId };
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `HTTP request failed (${response.status}) for ${url}${
        body ? `: ${body}` : ""
      }`,
    );
  }
  return await response.json();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown): Record<string, unknown> {
  assert(isRecord(value), "expected record");
  return value;
}

async function providerStatus(
  client: SurfaceStatusOnlyClient,
): Promise<TrellisSurfaceStatusOutput["status"]> {
  return await surfaceStatus(client, {
    contractId: providerContract.CONTRACT_ID,
    kind: "rpc",
    surface: "CatalogSurfaceStatus.Ping",
    action: "call",
  });
}

async function surfaceStatus(
  client: SurfaceStatusOnlyClient,
  input: TrellisSurfaceStatusInput,
): Promise<TrellisSurfaceStatusOutput["status"]> {
  return (await client.rpc.trellis.surfaceStatus(input).orThrow()).status;
}

async function assertSurfaceStatusValidationError(
  client: SurfaceStatusOnlyClient,
  input: TrellisSurfaceStatusInput,
): Promise<void> {
  const result = await client.rpc.trellis.surfaceStatus(input);
  const value = await result.take();
  assert(isErr(value));
  assertInstanceOf(value.error, ValidationError);
}

async function providerInstanceId(
  client: SurfaceStatusAdminClient,
  sessionKey: string,
): Promise<string> {
  const page = await client.rpc.auth.serviceInstancesList({ limit: 500 })
    .orThrow();
  const instance = page.entries.find((entry) =>
    entry.instanceKey === sessionKey
  );
  assert(instance, "expected provider service instance to be listed");
  return instance.instanceId;
}

async function connectionUserNkey(
  client: SurfaceStatusAdminClient,
  sessionKey: string,
): Promise<string | undefined> {
  const page = await client.rpc.auth.connectionsList({
    limit: 500,
    sessionKey,
  }).orThrow();
  return page.entries.find((entry) =>
    entry.sessionKey === sessionKey && entry.participantKind === "service"
  )?.userNkey;
}

type SurfaceStatusOnlyClient = {
  readonly rpc: {
    readonly trellis: {
      surfaceStatus(input: TrellisSurfaceStatusInput): SurfaceStatusResult;
    };
  };
};

type SurfaceStatusResult = {
  orThrow(): Promise<TrellisSurfaceStatusOutput>;
  take(): Promise<unknown>;
};

type SurfaceStatusAdminClient = SurfaceStatusOnlyClient & {
  readonly rpc: SurfaceStatusOnlyClient["rpc"] & {
    readonly auth: {
      serviceInstancesList(input: { limit: number }): {
        orThrow(): Promise<{
          entries: Array<{ instanceId: string; instanceKey: string }>;
        }>;
      };
      serviceInstancesDisable(input: { instanceId: string }): {
        orThrow(): Promise<unknown>;
      };
      connectionsKick(input: { userNkey: string }): {
        orThrow(): Promise<{ success: boolean }>;
      };
      connectionsList(input: { limit: number; sessionKey: string }): {
        orThrow(): Promise<{
          entries: Array<{
            participantKind: string;
            sessionKey: string;
            userNkey: string;
          }>;
        }>;
      };
      usersCreate(input: {
        username: string;
        name: string;
        email: string;
        active: boolean;
        capabilities: string[];
        capabilityGroups: string[];
      }): { orThrow(): Promise<{ user: { userId: string } }> };
      usersPasswordResetCreate(input: { userId: string }): {
        orThrow(): Promise<{ flowId: string }>;
      };
    };
  };
};

function randomSessionSeed(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}
