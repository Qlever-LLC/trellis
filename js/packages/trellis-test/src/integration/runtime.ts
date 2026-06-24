import {
  type ClientOpts,
  createAuth,
  type EventName,
  type TrellisAPI,
  TrellisClient,
} from "@qlever-llc/trellis";
import { TrellisTestRuntime } from "../runtime.ts";
import {
  startTrellisTestEventCapture,
  type TrellisTestEventCapture,
  type TrellisTestEventCaptureOptions,
  type TrellisTestEventSourceContract,
} from "../event_capture.ts";
import type {
  TrellisTestAuthorityPlanClassification,
  TrellisTestClientAuth,
  TrellisTestClientContract,
  TrellisTestConnectedClient,
  TrellisTestContractLike,
} from "../types.ts";
import { waitFor as waitForHelper } from "../wait.ts";
import { caseDeploymentId } from "./names.ts";
import {
  contractDescriptor,
  hasSharedRuntimeManifest,
  readSharedRuntimeManifest,
  TrellisIntegrationSharedRuntimeCoordinatorClient,
} from "./shared_runtime_client.ts";
import type { TrellisIntegrationSharedRuntimeManifest } from "./shared_runtime_protocol.ts";
import type {
  TrellisIntegrationRuntime,
  TrellisIntegrationRuntimeOptions,
  TrellisIntegrationScope,
  TrellisIntegrationTestOptions,
} from "./types.ts";

const DEFAULT_WAIT_FOR_MS = 10_000;

type ConnectedClient = { connection: { close(): Promise<void> } };
type EventCapture = { stop(): Promise<void> };

/** Returns an isolated runtime scope for a single direct integration test. */
export function runtimeScopeIsolated(): TrellisIntegrationScope {
  return { kind: "isolated" };
}

/**
 * Returns a case-scoped shared runtime scope for parallel-safe tests.
 *
 * In shared-runtime mode, the case id determines the default deployment via the
 * shared run id. Tests must still use case-scoped contracts, subjects, names,
 * state keys, and resource keys for full parallel isolation.
 */
export function runtimeScopeForCase(caseId: string): TrellisIntegrationScope {
  return { kind: "shared-case", caseId };
}

/** Runs a test body with deterministic Trellis runtime cleanup. */
export async function withTrellisIntegrationRuntime<T>(
  fn: (runtime: TrellisIntegrationRuntime) => Promise<T>,
  options: TrellisIntegrationRuntimeOptions,
): Promise<T> {
  const runtime = await TrellisTestRuntime.start(options);
  try {
    return await fn(runtime);
  } finally {
    await runtime.stop();
  }
}

/**
 * Registers a Deno integration test backed by Trellis test runtime support.
 *
 * Direct mode starts a new runtime and requires caller-supplied runtime options,
 * including the Trellis command. Shared-runtime mode is activated by the
 * `TRELLIS_TEST_SHARED_RUNTIME` manifest environment variable and attaches
 * `runtimeScopeForCase(...)` tests to the shared coordinator.
 */
export function trellisIntegrationTest(
  args: TrellisIntegrationTestOptions,
): void {
  const { name, scope, fn } = args;
  const useSharedRuntime = scope.kind === "shared-case" &&
    hasSharedRuntimeManifest();
  const liveRuntimeSanitizers = scope.kind === "shared-case";

  Deno.test({
    name,
    sanitizeResources: args.sanitizeResources ??
      (liveRuntimeSanitizers ? false : undefined),
    sanitizeOps: args.sanitizeOps ??
      (liveRuntimeSanitizers ? false : undefined),
    async fn() {
      if (useSharedRuntime) {
        const manifest = await readSharedRuntimeManifest();
        const runtime = new AttachedTrellisIntegrationRuntime(manifest, scope);
        try {
          await fn(runtime);
        } finally {
          await runtime.stop();
        }
        return;
      }

      if (args.runtime === undefined) {
        throw new Error(
          "trellisIntegrationTest requires runtime options unless a shared runtime manifest is present",
        );
      }
      await withTrellisIntegrationRuntime(fn, args.runtime);
    },
  });
}

class AttachedTrellisIntegrationRuntime implements TrellisIntegrationRuntime {
  readonly trellisUrl: string;
  readonly natsUrl: string;
  readonly workdir: string;
  readonly #coordinator: TrellisIntegrationSharedRuntimeCoordinatorClient;
  readonly #defaultDeployment: string;
  readonly #clients = new Set<ConnectedClient>();
  readonly #captures = new Set<EventCapture>();

  constructor(
    manifest: TrellisIntegrationSharedRuntimeManifest,
    scope: TrellisIntegrationScope,
  ) {
    this.trellisUrl = manifest.trellisUrl;
    this.natsUrl = manifest.natsUrl;
    this.workdir = manifest.workdir;
    this.#coordinator = new TrellisIntegrationSharedRuntimeCoordinatorClient(
      manifest,
    );
    this.#defaultDeployment = scope.kind === "shared-case"
      ? caseDeploymentId(manifest.runId, scope.caseId)
      : `js-it-${manifest.runId}-${crypto.randomUUID()}`;
  }

  get deployments() {
    const coordinator = this.#coordinator;
    const deployment = this.#defaultDeployment;
    return {
      create: (args: { readonly id?: string; readonly mutableDev?: boolean }) =>
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
        readonly deployment?: string;
        readonly contract: TrellisTestContractLike;
        readonly allowPlanClassifications?:
          readonly TrellisTestAuthorityPlanClassification[];
      }) =>
        coordinator.approveContract({
          deployment: args.deployment ?? this.#defaultDeployment,
          contract: contractDescriptor(args.contract),
          allowPlanClassifications: args.allowPlanClassifications,
        }),
    };
  }

  get services() {
    const coordinator = this.#coordinator;
    return {
      createInstance: (args: {
        readonly deployment?: string;
        readonly name: string;
        readonly contract: TrellisTestContractLike;
        readonly sessionKeySeed?: string;
      }) =>
        coordinator.createServiceInstance({
          deployment: args.deployment ?? this.#defaultDeployment,
          contract: contractDescriptor(args.contract),
          sessionKeySeed: args.sessionKeySeed,
        }),
      provisionInstanceOnly: (args: {
        readonly deployment?: string;
        readonly sessionKeySeed?: string;
      }) =>
        coordinator.provisionServiceInstanceOnly({
          deployment: args.deployment ?? this.#defaultDeployment,
          sessionKeySeed: args.sessionKeySeed,
        }),
    };
  }

  get authority() {
    const coordinator = this.#coordinator;
    return {
      plans: {
        list: (args: {
          readonly deploymentId?: string;
          readonly state?: "pending" | "accepted" | "rejected";
          readonly classification?: "update" | "migration";
          readonly limit?: number;
          readonly offset?: number;
        }) => coordinator.listAuthorityPlans(args),
        reject: (args: { readonly planId: string; readonly reason?: string }) =>
          coordinator.rejectAuthorityPlan(args),
      },
      acceptUpdate: (args: {
        readonly planId: string;
        readonly expectedDesiredVersion?: string;
      }) => coordinator.acceptAuthorityUpdate(args),
      acceptMigration: (args: {
        readonly planId: string;
        readonly acknowledgement: string;
        readonly expectedDesiredVersion?: string;
      }) => coordinator.acceptAuthorityMigration(args),
    };
  }

  async registerService(args: {
    readonly name: string;
    readonly contract: TrellisTestContractLike;
    readonly deployment?: string;
    readonly sessionKeySeed?: string;
  }): Promise<{ readonly seed: string; readonly sessionKey: string }> {
    return await this.#coordinator.registerService({
      deployment: args.deployment ?? this.#defaultDeployment,
      name: args.name,
      contract: contractDescriptor(args.contract),
      sessionKeySeed: args.sessionKeySeed,
    });
  }

  async registerClient(args: {
    readonly name: string;
    readonly contract: TrellisTestClientContract<TrellisAPI>;
    readonly sessionKeySeed?: string;
  }): Promise<{ readonly seed: string; readonly sessionKey: string }> {
    const seed = args.sessionKeySeed ?? randomSessionSeed();
    const auth = await createAuth({ sessionKeySeed: seed });
    return { seed, sessionKey: auth.sessionKey };
  }

  clientAuth(key: {
    readonly seed: string;
    readonly sessionKey: string;
  }): TrellisTestClientAuth {
    const coordinator = this.#coordinator;
    return {
      auth: {
        mode: "session_key",
        sessionKeySeed: key.seed,
        redirectTo: `${this.trellisUrl}/_trellis/test/client-auth`,
      },
      onAuthRequired: (ctx) => coordinator.completeClientAuth(ctx),
    };
  }

  async connectClient<TContract extends TrellisTestClientContract<TrellisAPI>>(
    args: ClientOpts & {
      readonly name: string;
      readonly contract: TContract;
      readonly sessionKeySeed?: string;
    },
  ): Promise<TrellisTestConnectedClient<TContract>> {
    const key = await this.registerClient(args);
    const auth = this.clientAuth(key);
    const client = await TrellisClient.connect({
      ...args,
      trellisUrl: this.trellisUrl,
      auth: auth.auth,
      onAuthRequired: auth.onAuthRequired,
    }).orThrow();
    this.#clients.add(client);
    return client as TrellisTestConnectedClient<TContract>;
  }

  async captureEvents<
    TContract extends TrellisTestEventSourceContract,
    const TEvents extends readonly EventName<TContract>[],
  >(
    args: TrellisTestEventCaptureOptions<TContract, TEvents>,
  ): Promise<TrellisTestEventCapture<TContract, TEvents[number]>> {
    const capture = await startTrellisTestEventCapture({
      runtime: this,
      options: args,
      onStop: (client, stoppedCapture) => {
        this.#clients.delete(client);
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
    opts?: { readonly timeoutMs?: number; readonly intervalMs?: number },
  ): Promise<T> {
    return await waitForHelper(fn, {
      timeoutMs: opts?.timeoutMs ?? DEFAULT_WAIT_FOR_MS,
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
