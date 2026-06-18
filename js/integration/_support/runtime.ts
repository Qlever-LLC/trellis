import { fromFileUrl } from "@std/path";
import { TrellisTestRuntime } from "@qlever-llc/trellis-test";
import type { TrellisTestRuntimeStartOptions } from "@qlever-llc/trellis-test";
import type {
  TrellisTestClientAuth,
  TrellisTestClientContract,
  TrellisTestConnectedClient,
  TrellisTestContractLike,
} from "@qlever-llc/trellis-test";
import {
  type ClientOpts,
  type ContractModule,
  createAuth,
  type TrellisAPI,
  type TrellisApiLike,
  TrellisClient,
} from "@qlever-llc/trellis";
import {
  startTrellisTestEventCapture,
  type TrellisTestEventCapture,
  type TrellisTestEventCaptureOptions,
  type TrellisTestEventSourceContract,
} from "@qlever-llc/trellis-test";
import {
  contractDescriptor,
  hasSharedRuntimeManifest,
  readSharedRuntimeManifest,
  SharedRuntimeCoordinatorClient,
} from "./shared_runtime_client.ts";
import type { SharedRuntimeManifest } from "./shared_runtime_protocol.ts";
import { caseDeploymentId } from "./names.ts";
import { waitFor as waitForHelper } from "@qlever-llc/trellis-test";

const repoJsRoot = fromFileUrl(new URL("../../", import.meta.url));

const DEFAULT_TIMEOUTS = {
  startupMs: 60_000,
  reconciliationMs: 15_000,
  waitForMs: 10_000,
  shutdownMs: 10_000,
};

// ---------------------------------------------------------------------------
// Live runtime scope types
// ---------------------------------------------------------------------------

/** Describes how a live integration test manages its TrellisTestRuntime. */
export type LiveRuntimeScope =
  | { kind: "isolated" }
  | { kind: "shared-case"; caseId: string };

/** Returns a case-scoped shared runtime scope for parallel-safe behavior tests. */
export function runtimeScopeForCase(caseId: string): LiveRuntimeScope {
  return { kind: "shared-case", caseId };
}

// ---------------------------------------------------------------------------
// Structural runtime interface
// ---------------------------------------------------------------------------

export type RuntimeContract = ContractModule<
  string,
  TrellisApiLike,
  TrellisApiLike,
  TrellisApiLike
>;

/** Structural interface for a live Trellis test runtime. */
export type LiveTrellisRuntime = {
  readonly trellisUrl: string;
  readonly natsUrl: string;
  readonly workdir: string;

  readonly deployments: {
    create(args: { id?: string; mutableDev?: boolean }): Promise<void>;
    reconcile(deployment: string): Promise<void>;
    waitReady(deployment: string): Promise<void>;
  };
  readonly contracts: {
    approve(args: {
      deployment?: string;
      contract: TrellisTestContractLike;
      allowPlanClassifications?: readonly string[];
    }): Promise<{ planId: string; classification: string }>;
  };
  readonly services: {
    createInstance(args: {
      deployment?: string;
      name: string;
      contract: TrellisTestContractLike;
      sessionKeySeed?: string;
    }): Promise<{ seed: string; sessionKey: string }>;
    provisionInstanceOnly(args: {
      deployment?: string;
      sessionKeySeed?: string;
    }): Promise<{ seed: string; sessionKey: string }>;
  };
  readonly authority?: {
    readonly plans: {
      list(args: {
        deploymentId?: string;
        state?: "pending" | "accepted" | "rejected";
        classification?: "update" | "migration";
        limit?: number;
        offset?: number;
      }): Promise<
        { entries: unknown[]; count: number; offset: number; limit: number }
      >;
      reject(
        args: { planId: string; reason?: string },
      ): Promise<{ success: boolean }>;
    };
    acceptUpdate(
      args: { planId: string; expectedDesiredVersion?: string },
    ): Promise<unknown>;
    acceptMigration(args: {
      planId: string;
      acknowledgement: string;
      expectedDesiredVersion?: string;
    }): Promise<unknown>;
  };

  registerService(args: {
    name: string;
    contract: TrellisTestContractLike;
    deployment?: string;
    sessionKeySeed?: string;
  }): Promise<{ seed: string; sessionKey: string }>;

  registerClient(args: {
    name: string;
    contract: TrellisTestClientContract<TrellisAPI>;
    sessionKeySeed?: string;
  }): Promise<{ seed: string; sessionKey: string }>;

  clientAuth(key: { seed: string; sessionKey: string }): TrellisTestClientAuth;

  connectClient<TContract extends TrellisTestClientContract<TrellisAPI>>(
    args: ClientOpts & {
      name: string;
      contract: TContract;
      sessionKeySeed?: string;
    },
  ): Promise<TrellisTestConnectedClient<TContract>>;

  captureEvents<
    TContract extends TrellisTestEventSourceContract,
    const TEvents extends readonly string[],
  >(
    args: TrellisTestEventCaptureOptions<TContract, TEvents>,
  ): Promise<TrellisTestEventCapture<TContract, TEvents[number]>>;

  waitFor<T>(
    fn: () =>
      | T
      | null
      | undefined
      | false
      | Promise<T | null | undefined | false>,
    opts?: { timeoutMs?: number; intervalMs?: number },
  ): Promise<T>;

  flush(): Promise<void>;
  stop?(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Attached runtime (parallel worker mode)
// ---------------------------------------------------------------------------

class AttachedLiveTrellisRuntime {
  readonly trellisUrl: string;
  readonly natsUrl: string;
  readonly workdir: string;
  readonly #coordinator: SharedRuntimeCoordinatorClient;
  readonly #defaultDeployment: string;
  readonly #manifest: SharedRuntimeManifest;
  readonly #clients = new Set<{ connection: { close(): Promise<void> } }>();
  readonly #captures = new Set<{ stop(): Promise<void> }>();

  constructor(
    manifest: SharedRuntimeManifest,
    scope: LiveRuntimeScope,
  ) {
    this.trellisUrl = manifest.trellisUrl;
    this.natsUrl = manifest.natsUrl;
    this.workdir = manifest.workdir;
    this.#manifest = manifest;
    this.#coordinator = new SharedRuntimeCoordinatorClient(manifest);
    this.#defaultDeployment = scope.kind === "shared-case"
      ? caseDeploymentId(manifest.runId, scope.caseId)
      : `js-it-${manifest.runId}-${crypto.randomUUID()}`;
  }

  get deployments() {
    const coordinator = this.#coordinator;
    const deployment = this.#defaultDeployment;
    return {
      create: (args: { id?: string; mutableDev?: boolean }) =>
        coordinator.createDeployment({
          deployment: args.id ?? deployment,
          mutableDev: args.mutableDev,
        }),
      reconcile: (dep: string) => coordinator.reconcile(dep),
      waitReady: (dep: string) => coordinator.waitReady(dep),
    };
  }

  get contracts() {
    const coordinator = this.#coordinator;
    return {
      approve: (args: {
        deployment?: string;
        contract: TrellisTestContractLike;
        allowPlanClassifications?: readonly string[];
      }) =>
        coordinator.approveContract({
          deployment: args.deployment ?? this.#defaultDeployment,
          contract: contractDescriptor(args.contract),
          allowPlanClassifications: args.allowPlanClassifications,
        }),
    };
  }

  get authority() {
    const coordinator = this.#coordinator;
    return {
      plans: {
        list: (args: {
          deploymentId?: string;
          state?: "pending" | "accepted" | "rejected";
          classification?: "update" | "migration";
          limit?: number;
          offset?: number;
        }) => coordinator.listAuthorityPlans(args),
        reject: (args: { planId: string; reason?: string }) =>
          coordinator.rejectAuthorityPlan(args),
      },
      acceptUpdate: (
        args: { planId: string; expectedDesiredVersion?: string },
      ) => coordinator.acceptAuthorityUpdate(args),
      acceptMigration: (
        args: {
          planId: string;
          acknowledgement: string;
          expectedDesiredVersion?: string;
        },
      ) => coordinator.acceptAuthorityMigration(args),
    };
  }

  get services() {
    const coordinator = this.#coordinator;
    return {
      createInstance: (args: {
        deployment?: string;
        name: string;
        contract: TrellisTestContractLike;
        sessionKeySeed?: string;
      }) =>
        coordinator.createServiceInstance({
          deployment: args.deployment ?? this.#defaultDeployment,
          contract: contractDescriptor(args.contract),
          sessionKeySeed: args.sessionKeySeed,
        }),
      provisionInstanceOnly: (args: {
        deployment?: string;
        sessionKeySeed?: string;
      }) =>
        coordinator.provisionServiceInstanceOnly({
          deployment: args.deployment ?? this.#defaultDeployment,
          sessionKeySeed: args.sessionKeySeed,
        }),
    };
  }

  async registerService(args: {
    name: string;
    contract: TrellisTestContractLike;
    deployment?: string;
    sessionKeySeed?: string;
  }): Promise<{ seed: string; sessionKey: string }> {
    return await this.#coordinator.registerService({
      deployment: args.deployment ?? this.#defaultDeployment,
      contract: contractDescriptor(args.contract),
      sessionKeySeed: args.sessionKeySeed,
    });
  }

  async registerClient(args: {
    name: string;
    contract: TrellisTestClientContract<TrellisAPI>;
    sessionKeySeed?: string;
  }): Promise<{ seed: string; sessionKey: string }> {
    const seed = args.sessionKeySeed ?? randomSessionSeed();
    const auth = await createAuth({ sessionKeySeed: seed });
    return { seed, sessionKey: auth.sessionKey };
  }

  clientAuth(key: { seed: string; sessionKey: string }): TrellisTestClientAuth {
    const coordinator = this.#coordinator;
    return {
      auth: {
        mode: "session_key" as const,
        sessionKeySeed: key.seed,
        redirectTo: `${this.trellisUrl}/_trellis/test/client-auth`,
      },
      onAuthRequired: (ctx) => coordinator.completeClientAuth(ctx),
    };
  }

  async connectClient<TContract extends TrellisTestClientContract<TrellisAPI>>(
    args: ClientOpts & {
      name: string;
      contract: TContract;
      sessionKeySeed?: string;
    },
  ): Promise<TrellisTestConnectedClient<TContract>> {
    const key = await this.registerClient(args);
    const authResult = this.clientAuth(key);
    const client = await TrellisClient.connect({
      ...args,
      trellisUrl: this.trellisUrl,
      auth: authResult.auth,
      onAuthRequired: authResult.onAuthRequired,
    }).orThrow();
    this.#clients.add(client);
    return client as TrellisTestConnectedClient<TContract>;
  }

  async captureEvents<
    TContract extends TrellisTestEventSourceContract,
    const TEvents extends readonly string[],
  >(
    args: TrellisTestEventCaptureOptions<TContract, TEvents>,
  ): Promise<TrellisTestEventCapture<TContract, TEvents[number]>> {
    const capture = await startTrellisTestEventCapture({
      // Provide a minimal runtime-like object that captureEvents needs
      runtime: this,
      options: args,
      onStop: (_client, stoppedCapture) => {
        this.#captures.delete(stoppedCapture);
      },
    });
    this.#captures.add(capture);
    return capture;
  }

  async waitFor<T>(
    fn: () =>
      | T
      | null
      | undefined
      | false
      | Promise<T | null | undefined | false>,
    opts?: { timeoutMs?: number; intervalMs?: number },
  ): Promise<T> {
    return await waitForHelper(fn, {
      timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUTS.waitForMs,
      intervalMs: opts?.intervalMs,
    });
  }

  async flush(): Promise<void> {
    await this.#coordinator.flush();
  }

  async stop(): Promise<void> {
    const failures: unknown[] = [];
    for (const capture of [...this.#captures]) {
      try {
        await capture.stop();
      } catch (error) {
        failures.push(error);
      }
    }
    for (const client of [...this.#clients]) {
      try {
        await client.connection.close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Failed to clean up ${failures.length} attached runtime resource(s)`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// liveTrellisTest – shared and isolated live test registration
// ---------------------------------------------------------------------------

/**
 * Registers a Deno integration test backed by a live Trellis runtime.
 *
 * In shared manifest mode (parallel workers), uses an `AttachedLiveTrellisRuntime`
 * that proxies admin operations through a coordinator server.
 *
 * In direct mode, uses per-test isolation.
 */
export function liveTrellisTest(
  args: {
    name: string;
    scope: LiveRuntimeScope;
    fn: (runtime: LiveTrellisRuntime) => Promise<void>;
  },
): void {
  const { name, scope, fn } = args;

  if (scope.kind === "isolated") {
    Deno.test({
      name,
      async fn() {
        await withTrellisRuntime(fn);
      },
    });
    return;
  }

  // Parallel mode: every test module attaches to the one shared runtime host.
  if (hasSharedRuntimeManifest()) {
    Deno.test({
      name,
      sanitizeResources: false,
      sanitizeOps: false,
      async fn() {
        const manifest = await readSharedRuntimeManifest();
        const runtime = new AttachedLiveTrellisRuntime(manifest, scope);
        try {
          await fn(runtime);
        } finally {
          await runtime.stop();
        }
      },
    });
    return;
  }

  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    async fn() {
      await withTrellisRuntime(fn);
    },
  });
}

// ---------------------------------------------------------------------------
// Existing isolated helpers (unchanged)
// ---------------------------------------------------------------------------

/** Starts the repo-local Trellis runtime for JS integration tests. */
export async function startTrellisRuntime(
  options: Partial<TrellisTestRuntimeStartOptions> = {},
): Promise<TrellisTestRuntime> {
  return await TrellisTestRuntime.start({
    ...options,
    keepWorkdir: options.keepWorkdir ?? keepWorkdirFromEnv(),
    trellis: {
      mutableDev: options.trellis?.mutableDev ?? true,
      command: options.trellis?.command ?? {
        cmd: Deno.execPath(),
        args: ["run", "-A", "./services/trellis/main.ts"],
        cwd: repoJsRoot,
      },
    },
    timeouts: {
      ...DEFAULT_TIMEOUTS,
      ...options.timeouts,
    },
  });
}

/** Runs an integration test body with deterministic Trellis runtime cleanup. */
export async function withTrellisRuntime<T>(
  fn: (runtime: LiveTrellisRuntime) => Promise<T>,
  options: Partial<TrellisTestRuntimeStartOptions> = {},
): Promise<T> {
  const runtime = await startTrellisRuntime(options);
  try {
    return await fn(runtime);
  } finally {
    await runtime.stop();
  }
}

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

function keepWorkdirFromEnv(): boolean {
  const value = Deno.env.get("TRELLIS_TEST_KEEP_WORKDIR")?.toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}
