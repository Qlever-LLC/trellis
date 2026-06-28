import { join } from "@std/path";
import { Kvm } from "@nats-io/kv";
import type { ConsumerInfo } from "@nats-io/jetstream";
import { connect, credsAuthenticator } from "@nats-io/transport-deno";
import {
  type ClientAuthContinuation,
  type ClientAuthRequiredContext,
  type ClientOpts,
  type ContractModule,
  createAuth,
  type EventName,
  type TrellisAPI,
  type TrellisApiLike,
  TrellisClient,
} from "@qlever-llc/trellis";
import { recordTrellisDuration } from "@qlever-llc/trellis/telemetry";
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
import type {
  JetStreamAckObserver,
  NatsMessageObserver,
} from "./nats_container.ts";
import { sqliteMemoryUrl as sqliteMemoryUrlHelper } from "./temp.ts";
import {
  startTrellisProcess,
  type TrellisProcessHandle,
} from "./trellis_process.ts";
import { TrellisControlPlaneSqlite } from "./control_plane_sqlite.ts";
import type {
  TrellisTestAuthorityPlanClassification,
  TrellisTestClientAuth,
  TrellisTestClientContract,
  TrellisTestClientKey,
  TrellisTestConnectedClient,
  TrellisTestContractApproval,
  TrellisTestContractLike,
  TrellisTestControlPlane,
  TrellisTestRawAuthConnectionPresence,
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
        contract: TrellisTestContractLike;
        allowPlanClassifications?:
          readonly TrellisTestAuthorityPlanClassification[];
      },
    ): Promise<TrellisTestContractApproval>;
  };
  readonly services: {
    createInstance(args: {
      deployment?: string;
      name: string;
      contract: TrellisTestContractLike;
      sessionKeySeed?: string;
    }): Promise<TrellisTestServiceKey>;
    provisionInstanceOnly(args: {
      deployment?: string;
      sessionKeySeed?: string;
    }): Promise<{ seed: string; sessionKey: string }>;
  };
  readonly authority: {
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
  readonly controlPlane: TrellisTestControlPlane;
  #controlPlane: TrellisProcessHandle;
  #nats: NatsTestContainer;
  #admin: TrellisTestAdminAutomation;
  #configPath: string;
  #trellisOptions: TrellisTestRuntimeStartOptions["trellis"];
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
    configPath: string;
    controlPlaneSqlitePath: string;
    trellisOptions: TrellisTestRuntimeStartOptions["trellis"];
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
    this.#configPath = args.configPath;
    this.#trellisOptions = args.trellisOptions;
    this.#admin = args.admin;
    this.controlPlane = {
      sqlite: new TrellisControlPlaneSqlite(args.controlPlaneSqlitePath),
    };
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
      provisionInstanceOnly: ({ deployment, sessionKeySeed }) =>
        this.#admin.provisionServiceInstanceOnly({
          deployment: deployment ?? this.#deployment,
          sessionKeySeed,
        }),
    };
    this.authority = {
      plans: {
        list: (args) => this.#admin.listAuthorityPlans(args),
        reject: (args) => this.#admin.rejectAuthorityPlan(args),
      },
      acceptUpdate: (args) => this.#admin.acceptAuthorityUpdate(args),
      acceptMigration: (args) => this.#admin.acceptAuthorityMigration(args),
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
        oauthProviders: options.oauthProviders,
        failOnceHooks: options.failOnceHooks,
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
        configPath,
        controlPlaneSqlitePath: config.storage.dbPath,
        trellisOptions: options.trellis,
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
    contract: TrellisTestContractLike;
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

  /**
   * Completes a test app/client auth flow through runtime admin automation.
   * Used by the parallel integration runner coordinator to proxy auth flows
   * from worker processes.
   */
  async completeClientAuth(
    ctx: ClientAuthRequiredContext,
  ): Promise<ClientAuthContinuation> {
    return await this.#admin.completeClientAuth(ctx);
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
    const startedAt = performance.now();
    const key = await this.registerClient(args);
    const auth = this.clientAuth(key);
    const client = await TrellisClient.connect({
      ...args,
      trellisUrl: this.trellisUrl,
      auth: auth.auth,
      onAuthRequired: auth.onAuthRequired,
    }).orThrow();
    this.#clients.add(client);
    recordTrellisDuration(
      "trellis.connect.duration",
      performance.now() - startedAt,
      { participantKind: "client", phase: "total" },
    );
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

  /** Lists JetStream consumers on the scratch NATS `trellis` event stream. */
  async listTrellisJetStreamConsumers(): Promise<ConsumerInfo[]> {
    return await this.#nats.listTrellisJetStreamConsumers();
  }

  /** Deletes a JetStream consumer from the scratch NATS server by stream and durable/name. */
  async deleteJetStreamConsumer(
    stream: string,
    name: string,
  ): Promise<boolean> {
    return await this.#nats.deleteJetStreamConsumer(stream, name);
  }

  /** Seeds one raw auth connection-presence KV entry for malformed-entry tests. */
  async seedRawAuthConnectionPresence(
    args: TrellisTestRawAuthConnectionPresence,
  ): Promise<void> {
    const nc = await connect({
      servers: this.#nats.natsUrl,
      authenticator: credsAuthenticator(
        await Deno.readFile(
          join(this.workdir, "nats", "creds", "auth-auth.creds"),
        ),
      ),
    });
    try {
      const kv = await new Kvm(nc).open("trellis_connections");
      await kv.put(args.key, JSON.stringify(args.value));
    } finally {
      await nc.close().catch(() => undefined);
    }
  }

  /** Observes JetStream ACK reply frames on the scratch NATS server. */
  async startJetStreamAckObserver(
    subject?: string,
  ): Promise<JetStreamAckObserver> {
    return await this.#nats.startJetStreamAckObserver(subject);
  }

  /** Observes raw NATS messages with selected headers on the scratch NATS server. */
  async startNatsMessageObserver(
    subject: string,
    headerNames: readonly string[] = [],
  ): Promise<NatsMessageObserver> {
    return await this.#nats.startNatsMessageObserver(subject, headerNames);
  }

  /** Restarts only the Trellis control-plane process, preserving workdir, SQLite state, and NATS. */
  async restartControlPlane(): Promise<void> {
    if (this.#stopped) {
      throw new Error("Cannot restart a stopped Trellis test runtime");
    }

    await this.#admin.prepareForControlPlaneRestart();
    await this.#controlPlane.stop();
    this.#controlPlane = await startTrellisProcess({
      trellisUrl: this.trellisUrl,
      configPath: this.#configPath,
      options: this.#trellisOptions,
      startupTimeoutMs: this.#timeouts.startupMs,
      shutdownTimeoutMs: this.#timeouts.shutdownMs,
    });
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
