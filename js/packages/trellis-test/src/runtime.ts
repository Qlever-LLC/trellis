import { join } from "@std/path";
import {
  type ClientOpts,
  type ContractModule,
  createAuth,
  type EventName,
  type TrellisAPI,
  type TrellisApiLike,
  TrellisClient,
} from "@qlever-llc/trellis";
import { TrellisTestAdminAutomation } from "./admin_client.ts";
import {
  buildControlPlaneConfig,
  generateSessionSeed,
  reserveLocalPort,
  writeTrellisConfig,
} from "./control_plane_config.ts";
import {
  startTrellisTestEventCapture,
  TrellisTestEventCapture,
  type TrellisTestEventCaptureOptions,
  type TrellisTestEventSourceContract,
} from "./event_capture.ts";
import { NatsTestContainer } from "./nats_container.ts";
import { sqliteMemoryUrl as sqliteMemoryUrlHelper } from "./temp.ts";
import {
  startTrellisProcess,
  type TrellisProcessHandle,
} from "./trellis_process.ts";
import type {
  TrellisTestAuthorityPlanClassification,
  TrellisTestClientAuth,
  TrellisTestClientContract,
  TrellisTestClientKey,
  TrellisTestConnectedClient,
  TrellisTestContractApproval,
  TrellisTestRuntimeStartOptions,
  TrellisTestServiceKey,
  WaitForOptions,
} from "./types.ts";
import { waitFor as waitForHelper } from "./wait.ts";

type ConnectedClient = { connection: { close(): Promise<void> } };
type EventCapture = { stop(): Promise<void> };
type RuntimeContract = ContractModule<
  string,
  TrellisApiLike,
  TrellisApiLike,
  TrellisApiLike
>;

type RuntimeTimeouts = {
  startupMs: number;
  reconciliationMs: number;
  waitForMs: number;
  shutdownMs: number;
};

/** Runs an isolated Trellis control plane and NATS server for integration tests. */
export class TrellisTestRuntime implements AsyncDisposable {
  readonly trellisUrl: string;
  readonly natsUrl: string;
  readonly workdir: string;
  readonly deployments: {
    create(args: { id?: string; mutableDev?: boolean }): Promise<void>;
    reconcile(deployment: string): Promise<void>;
    waitReady(deployment: string): Promise<void>;
  };
  readonly contracts: {
    approve(
      args: {
        deployment?: string;
        contract: RuntimeContract;
        allowPlanClassifications?:
          readonly TrellisTestAuthorityPlanClassification[];
      },
    ): Promise<TrellisTestContractApproval>;
  };
  readonly services: {
    createInstance(args: {
      deployment?: string;
      name: string;
      contract: RuntimeContract;
      sessionKeySeed?: string;
    }): Promise<TrellisTestServiceKey>;
  };
  #controlPlane: TrellisProcessHandle;
  #nats: NatsTestContainer;
  #admin: TrellisTestAdminAutomation;
  #keepWorkdir: boolean;
  #deployment: string;
  #timeouts: RuntimeTimeouts;
  #clients = new Set<ConnectedClient>();
  #captures = new Set<EventCapture>();
  #stopped = false;

  private constructor(args: {
    trellisUrl: string;
    workdir: string;
    deployment: string;
    keepWorkdir: boolean;
    timeouts: RuntimeTimeouts;
    nats: NatsTestContainer;
    controlPlane: TrellisProcessHandle;
    admin: TrellisTestAdminAutomation;
  }) {
    this.trellisUrl = args.trellisUrl;
    this.natsUrl = args.nats.natsUrl;
    this.workdir = args.workdir;
    this.#deployment = args.deployment;
    this.#keepWorkdir = args.keepWorkdir;
    this.#timeouts = args.timeouts;
    this.#nats = args.nats;
    this.#controlPlane = args.controlPlane;
    this.#admin = args.admin;
    this.deployments = {
      create: ({ id, mutableDev }) =>
        this.#admin.createDeployment({
          deployment: id ?? this.#deployment,
          mutableDev,
        }),
      reconcile: (deployment) => this.#admin.reconcile(deployment),
      waitReady: (deployment) => this.#admin.waitReady(deployment),
    };
    this.contracts = {
      approve: ({ deployment, contract, allowPlanClassifications }) =>
        this.#admin.approveContract({
          deployment: deployment ?? this.#deployment,
          contract,
          allowPlanClassifications,
        }),
    };
    this.services = {
      createInstance: ({ deployment, contract, sessionKeySeed }) =>
        this.#admin.provisionServiceInstance({
          deployment: deployment ?? this.#deployment,
          contract,
          sessionKeySeed,
        }),
    };
  }

  /** Starts an isolated Trellis test runtime. */
  static async start(
    options: TrellisTestRuntimeStartOptions,
  ): Promise<TrellisTestRuntime> {
    if (options?.trellis?.command === undefined) {
      throw new Error("TrellisTestRuntime.start requires trellis.command");
    }
    if (options.nats !== undefined && options.nats !== "container") {
      throw new Error("TrellisTestRuntime only supports nats: 'container'");
    }
    const workdir = await Deno.makeTempDir({ prefix: "trellis-test-" });
    let nats: NatsTestContainer | undefined;
    let controlPlane: TrellisProcessHandle | undefined;
    try {
      const timeouts = {
        startupMs: options.timeouts?.startupMs ?? 30_000,
        reconciliationMs: options.timeouts?.reconciliationMs ?? 5_000,
        waitForMs: options.timeouts?.waitForMs ?? 5_000,
        shutdownMs: options.timeouts?.shutdownMs ?? 5_000,
      };
      await Deno.mkdir(join(workdir, "trellis"), { recursive: true });
      nats = await NatsTestContainer.start(workdir, {
        startupMs: timeouts.startupMs,
      });
      const port = reserveLocalPort();
      const trellisUrl = `http://127.0.0.1:${port}`;
      const config = buildControlPlaneConfig({
        workdir,
        natsUrl: nats.natsUrl,
        websocketUrl: nats.websocketUrl,
        manifest: nats.manifest,
        port,
      });
      const configPath = await writeTrellisConfig({ workdir, config });
      const deployment = options.deployment ?? "test";
      const adminPassword = `trellis-test-${generateSessionSeed()}`;
      const startedControlPlane = await startTrellisProcess({
        trellisUrl,
        configPath,
        options: options.trellis,
        startupTimeoutMs: timeouts.startupMs,
        shutdownTimeoutMs: timeouts.shutdownMs,
      });
      controlPlane = startedControlPlane;
      return new TrellisTestRuntime({
        trellisUrl: startedControlPlane.trellisUrl,
        workdir,
        deployment,
        keepWorkdir: options.keepWorkdir ?? false,
        timeouts,
        nats,
        controlPlane: startedControlPlane,
        admin: new TrellisTestAdminAutomation({
          trellisUrl: startedControlPlane.trellisUrl,
          adminPassword,
          defaultDeployment: deployment,
          defaultMutableDev: options.trellis.mutableDev ?? true,
          reconciliationMs: timeouts.reconciliationMs,
          autoAccept: options.authority?.autoAccept ?? ["update"],
          getBootstrapUrl: () =>
            startedControlPlane.waitForBootstrapUrl(timeouts.startupMs),
        }),
      });
    } catch (error) {
      await controlPlane?.stop().catch(() => undefined);
      await nats?.stop().catch(() => undefined);
      if (!options.keepWorkdir) {
        await Deno.remove(workdir, { recursive: true }).catch(() => undefined);
      }
      throw error;
    }
  }

  /** Registers a service contract and creates a service instance key. */
  async registerService(args: {
    name: string;
    contract: RuntimeContract;
    deployment?: string;
    sessionKeySeed?: string;
  }): Promise<TrellisTestServiceKey> {
    return await this.#admin.registerService({
      deployment: args.deployment ?? this.#deployment,
      contract: args.contract,
      sessionKeySeed: args.sessionKeySeed,
    });
  }

  /** Creates app/client session-key material for public `TrellisClient.connect` calls. */
  async registerClient(args: {
    name: string;
    contract: TrellisTestClientContract;
    sessionKeySeed?: string;
  }): Promise<TrellisTestClientKey> {
    const seed = args.sessionKeySeed ?? generateSessionSeed();
    const auth = await createAuth({ sessionKeySeed: seed });
    return { seed, sessionKey: auth.sessionKey };
  }

  /**
   * Returns auth options and admin-backed auth continuation for a registered
   * app/client participant. Spread the result into `TrellisClient.connect(...)`.
   */
  clientAuth(key: TrellisTestClientKey): TrellisTestClientAuth {
    return {
      auth: {
        mode: "session_key",
        sessionKeySeed: key.seed,
        redirectTo: `${this.trellisUrl}/_trellis/test/client-auth`,
      },
      onAuthRequired: (ctx) => this.#admin.completeClientAuth(ctx),
    };
  }

  /** Connects an app/client participant through the public generated client surface. */
  async connectClient<
    TContract extends TrellisTestClientContract<TrellisAPI>,
  >(
    args: ClientOpts & {
      name: string;
      contract: TContract;
      sessionKeySeed?: string;
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

  /**
   * Captures live decoded contract events through a synthetic app participant.
   *
   * The capture subscribes with generated event facade listeners in ephemeral mode
   * and uses normal `uses.events.subscribe` authority for the selected source
   * contract events.
   */
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

  /** Polls until `fn` returns a truthy value. */
  waitFor<T>(
    fn: () =>
      | T
      | null
      | undefined
      | false
      | Promise<T | null | undefined | false>,
    opts?: WaitForOptions,
  ): Promise<T> {
    return waitForHelper(fn, {
      timeoutMs: opts?.timeoutMs ?? this.#timeouts.waitForMs,
      intervalMs: opts?.intervalMs,
    });
  }

  /** Flushes the underlying NATS connection. */
  async flush(): Promise<void> {
    await this.#nats.nc.flush();
  }

  /** Drains the underlying NATS connection. */
  async drain(): Promise<void> {
    await this.#nats.nc.drain();
  }

  /** Returns a service-owned SQLite path under this runtime workdir. */
  async tempSqlitePath(name = "test.sqlite"): Promise<string> {
    const dir = join(this.workdir, "sqlite");
    await Deno.mkdir(dir, { recursive: true });
    return join(dir, name);
  }

  /** Returns the SQLite in-memory URL used by service-owned tests. */
  sqliteMemoryUrl(): string {
    return sqliteMemoryUrlHelper();
  }

  /** Stops clients, control plane, NATS, and the temp directory. */
  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    const failures: unknown[] = [];
    for (const capture of [...this.#captures]) {
      try {
        await capture.stop();
      } catch (error) {
        failures.push(error);
      }
    }
    for (const client of this.#clients) {
      try {
        await client.connection.close();
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await this.#admin.close();
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.#controlPlane.stop();
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.#nats.stop();
    } catch (error) {
      failures.push(error);
    }
    if (!this.#keepWorkdir) {
      try {
        await Deno.remove(this.workdir, { recursive: true });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Failed to clean up ${failures.length} Trellis test runtime resource(s)`,
      );
    }
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.stop();
  }
}
