import type { ConsumerInfo } from "@nats-io/jetstream";
import { Kvm } from "@nats-io/kv";
import { connect, credsAuthenticator } from "@nats-io/transport-deno";
import {
  type ClientAuthContinuation,
  type ClientAuthRequiredContext,
  type ClientOpts,
  createAuth,
  TrellisClient,
} from "@qlever-llc/trellis";
import { recordTrellisDuration as recordOpenTelemetryDuration } from "@qlever-llc/trellis/telemetry";
import { dirname, join } from "@std/path";

import { TrellisTestAdminAutomation } from "./admin_client.ts";
import type { LocalNatsBootstrapManifest } from "./nats_bootstrap.ts";
import {
  removeStaleMarkedDirectories,
  writeTrellisTestOwnerMarker,
} from "./cleanup.ts";
import {
  buildControlPlaneConfig,
  generateSessionSeed,
  type ReservedPort,
  reserveLocalPort,
  writeTrellisConfig,
} from "./control_plane_config.ts";
import { TrellisControlPlaneSqlite } from "./control_plane_sqlite.ts";
import {
  startTrellisTestEventCapture,
  type TrellisTestEventAction,
  type TrellisTestEventCapture,
  type TrellisTestEventCaptureOptions,
  type TrellisTestEventSourceContract,
} from "./event_capture.ts";
import { NatsTestContainer } from "./nats_container.ts";
import { recordTrellisTestDuration } from "./integration/metrics.ts";

function recordTrellisDuration(
  name: Parameters<typeof recordOpenTelemetryDuration>[0],
  durationMs: number,
  attributes?: Parameters<typeof recordOpenTelemetryDuration>[2],
): void {
  recordOpenTelemetryDuration(name, durationMs, attributes);
  void recordTrellisTestDuration(name, durationMs, attributes);
}
import type {
  JetStreamAckObserver,
  NatsMessageObserver,
} from "./nats_container.ts";
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
  TrellisTestContractLike,
  TrellisTestControlPlane,
  TrellisTestRawAuthConnectionPresence,
  TrellisTestRawStateEntry,
  TrellisTestRuntimeStartOptions,
  TrellisTestServiceKey,
  WaitForOptions,
} from "./types.ts";
import { waitFor as waitForHelper } from "./wait.ts";

type ConnectedClient = { connection: { close(): Promise<void> } };
type EventCapture = { stop(): Promise<void> };
type RuntimeTimeouts = {
  startupMs: number;
  reconciliationMs: number;
  waitForMs: number;
  shutdownMs: number;
};

const WORKDIR_PREFIX = "trellis-test-";
const WORKDIR_OWNER_MARKER = ".trellis-test-owner";

class TcpProxy {
  readonly url: string;
  readonly #listener: Deno.TcpListener;
  readonly #target: Deno.ConnectOptions;
  readonly #connections = new Set<Deno.Conn>();

  private constructor(listener: Deno.TcpListener, target: Deno.ConnectOptions) {
    this.#listener = listener;
    this.#target = target;
    this.url = `ws://127.0.0.1:${listener.addr.port}`;
    this.#accept();
  }

  static start(targetUrl: string): TcpProxy {
    const target = new URL(targetUrl);
    return new TcpProxy(
      Deno.listen({ hostname: "127.0.0.1", port: 0 }),
      {
        transport: "tcp",
        hostname: target.hostname,
        port: Number(target.port),
      },
    );
  }

  async #accept(): Promise<void> {
    try {
      for await (const client of this.#listener) {
        this.#connections.add(client);
        void this.#forward(client);
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.BadResource)) throw error;
    }
  }

  async #forward(client: Deno.Conn): Promise<void> {
    try {
      const upstream = await Deno.connect(this.#target);
      this.#connections.add(upstream);
      await Promise.allSettled([
        client.readable.pipeTo(upstream.writable),
        upstream.readable.pipeTo(client.writable),
      ]);
      this.#connections.delete(upstream);
      try {
        upstream.close();
      } catch {
        // The stream may already have closed the connection.
      }
    } finally {
      this.#connections.delete(client);
      try {
        client.close();
      } catch {
        // The stream may already have closed the connection.
      }
    }
  }

  stop(): void {
    this.#listener.close();
    for (const connection of this.#connections) {
      try {
        connection.close();
      } catch {
        // The peer may have closed first.
      }
    }
    this.#connections.clear();
  }
}

/** Runs an isolated Trellis control plane and NATS server for integration tests. */
export class TrellisTestRuntime implements AsyncDisposable {
  readonly trellisUrl: string;
  readonly natsUrl: string;
  readonly workdir: string;
  readonly deployments: {
    create(args: { id?: string; kind?: "service" | "device" }): Promise<void>;
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
  readonly devices: {
    provision(
      input: import("@trellis/apis/trellis.auth").AuthDevicesProvisionInput,
    ): Promise<
      import("@trellis/apis/trellis.auth").AuthDevicesProvisionOutput
    >;
  };
  readonly state: {
    adminGet(
      input: import("@trellis/apis/trellis.state").StateAdminGetInput,
    ): Promise<import("@trellis/apis/trellis.state").StateAdminGetOutput>;
    adminList(
      input: import("@trellis/apis/trellis.state").StateAdminListInput,
    ): Promise<import("@trellis/apis/trellis.state").StateAdminListOutput>;
    adminDelete(
      input: import("@trellis/apis/trellis.state").StateAdminDeleteInput,
    ): Promise<import("@trellis/apis/trellis.state").StateAdminDeleteOutput>;
  };
  readonly authority: {
    readonly plans: {
      list(args: {
        deploymentId?: string;
        state?: "pending" | "accepted" | "rejected" | "superseded" | "expired";
        limit?: number;
        cursor?: string;
      }): Promise<{ entries: unknown[]; nextCursor: string | null }>;
      reject(
        args: { planId: string; reason?: string },
      ): Promise<unknown>;
    };
    acceptUpdate(
      args: { planId: string; expectedDesiredVersion?: number },
    ): Promise<unknown>;
    acceptMigration(args: {
      planId: string;
      acknowledgement: string;
      expectedDesiredVersion?: number;
    }): Promise<unknown>;
  };
  readonly controlPlane?: TrellisTestControlPlane;
  #controlPlane: TrellisProcessHandle | undefined;
  #nats: NatsTestContainer;
  #admin: TrellisTestAdminAutomation;
  #configPath: string | undefined;
  #config: ReturnType<typeof buildControlPlaneConfig> | undefined;
  #websocketProxy: TcpProxy | undefined;
  #trellisOptions: TrellisTestRuntimeStartOptions["trellis"] | undefined;
  #keepWorkdir: boolean;
  #ownsWorkdir: boolean;
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
    configPath?: string;
    config?: ReturnType<typeof buildControlPlaneConfig>;
    websocketProxy?: TcpProxy;
    controlPlaneSqlitePath?: string;
    trellisOptions?: TrellisTestRuntimeStartOptions["trellis"];
    nats: NatsTestContainer;
    controlPlane?: TrellisProcessHandle;
    admin: TrellisTestAdminAutomation;
    ownsWorkdir?: boolean;
  }) {
    this.trellisUrl = args.trellisUrl;
    this.natsUrl = args.nats.natsUrl;
    this.workdir = args.workdir;
    this.#deployment = args.deployment;
    this.#keepWorkdir = args.keepWorkdir;
    this.#ownsWorkdir = args.ownsWorkdir ?? true;
    this.#timeouts = args.timeouts;
    this.#nats = args.nats;
    this.#controlPlane = args.controlPlane;
    this.#configPath = args.configPath;
    this.#config = args.config;
    this.#websocketProxy = args.websocketProxy;
    this.#trellisOptions = args.trellisOptions;
    this.#admin = args.admin;
    if (args.controlPlaneSqlitePath !== undefined) {
      this.controlPlane = {
        sqlite: new TrellisControlPlaneSqlite(args.controlPlaneSqlitePath),
      };
    }
    this.deployments = {
      create: ({ id, kind }) =>
        this.#admin.createDeployment({
          deployment: id ?? this.#deployment,
          kind,
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
    this.devices = {
      provision: (input) => this.#admin.provisionDevice(input),
    };
    this.state = {
      adminGet: (input) => this.#admin.stateAdminGet(input),
      adminList: (input) => this.#admin.stateAdminList(input),
      adminDelete: (input) => this.#admin.stateAdminDelete(input),
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
    const workdir = await Deno.makeTempDir({ prefix: WORKDIR_PREFIX });
    await writeTrellisTestOwnerMarker(workdir, WORKDIR_OWNER_MARKER);
    await removeStaleMarkedDirectories({
      parent: dirname(workdir),
      prefix: WORKDIR_PREFIX,
      markerName: WORKDIR_OWNER_MARKER,
    });
    let nats: NatsTestContainer | undefined;
    let controlPlane: TrellisProcessHandle | undefined;
    let portLease: ReservedPort | undefined;
    let websocketProxy: TcpProxy | undefined;
    try {
      const timeouts = {
        startupMs: options.timeouts?.startupMs ?? 30_000,
        reconciliationMs: options.timeouts?.reconciliationMs ?? 5_000,
        waitForMs: options.timeouts?.waitForMs ?? 5_000,
        shutdownMs: options.timeouts?.shutdownMs ?? 5_000,
      };
      await Deno.mkdir(join(workdir, "trellis"), { recursive: true });
      const sharedManifest = typeof options.nats === "object"
        ? structuredClone(options.nats.manifest)
        : undefined;
      if (typeof options.nats === "object" && sharedManifest !== undefined) {
        const sharedNatsDir = join(options.nats.workdir, "nats");
        const localNatsDir = join(workdir, "nats");
        await Deno.mkdir(join(localNatsDir, "creds"), { recursive: true });
        await Deno.mkdir(join(localNatsDir, "secrets"), { recursive: true });
        const copies = [
          [sharedManifest.paths.creds.systemService, "creds/system.creds"],
          [sharedManifest.paths.creds.authService, "creds/auth-auth.creds"],
          [
            sharedManifest.paths.creds.trellisService,
            "creds/trellis-auth.creds",
          ],
          [
            sharedManifest.paths.secrets.authIssuerSigning,
            "secrets/auth-issuer-signing.seed",
          ],
          [
            sharedManifest.paths.secrets.authTargetSigning,
            "secrets/auth-target-signing.seed",
          ],
          [
            sharedManifest.paths.secrets.authCalloutXKey,
            "secrets/auth-sx.seed",
          ],
        ] as const;
        await Promise.all(
          copies.map(([source, target]) =>
            Deno.copyFile(
              join(sharedNatsDir, source),
              join(localNatsDir, target),
            )
          ),
        );
        sharedManifest.paths.creds = {
          systemService: "creds/system.creds",
          authService: "creds/auth-auth.creds",
          trellisService: "creds/trellis-auth.creds",
        };
        sharedManifest.paths.secrets = {
          authIssuerSigning: "secrets/auth-issuer-signing.seed",
          authTargetSigning: "secrets/auth-target-signing.seed",
          authCalloutXKey: "secrets/auth-sx.seed",
        };
      }
      nats = typeof options.nats === "object"
        ? await NatsTestContainer.attach({
          ...options.nats,
          workdir,
          manifest: sharedManifest ?? (() => {
            throw new Error("shared NATS manifest was not initialized");
          })(),
        })
        : await NatsTestContainer.start(workdir, {
          startupMs: timeouts.startupMs,
        });
      if (options.rotatableWebsocketProxy) {
        websocketProxy = TcpProxy.start(nats.websocketUrl);
      }
      let config: ReturnType<typeof buildControlPlaneConfig>;
      let configPath: string;
      let startedControlPlane: TrellisProcessHandle;
      for (let attempt = 1;; attempt++) {
        portLease = reserveLocalPort();
        const port = portLease.port;
        const trellisUrl = `http://127.0.0.1:${port}`;
        config = buildControlPlaneConfig({
          workdir,
          natsUrl: nats.natsUrl,
          websocketUrl: websocketProxy?.url ?? nats.websocketUrl,
          manifest: sharedManifest ?? nats.manifest,
          port,
          oauthProviders: options.oauthProviders,
          webOrigins: options.webOrigins,
          webSource: options.webSource,
          portalSource: options.portalSource,
          consoleSource: options.consoleSource,
        });
        configPath = await writeTrellisConfig({ workdir, config });
        try {
          startedControlPlane = await startTrellisProcess({
            trellisUrl,
            configPath,
            options: options.trellis,
            startupTimeoutMs: timeouts.startupMs,
            shutdownTimeoutMs: timeouts.shutdownMs,
            portLease,
          });
          portLease = undefined;
          break;
        } catch (error) {
          portLease = undefined;
          if (
            attempt >= 3 ||
            !String(error).toLowerCase().includes("address already in use")
          ) {
            throw error;
          }
        }
      }
      const deployment = options.deployment ?? "test";
      const adminPassword = options.adminPassword ??
        `trellis-test-${generateSessionSeed()}`;
      controlPlane = startedControlPlane;
      const admin = new TrellisTestAdminAutomation({
        trellisUrl: startedControlPlane.trellisUrl,
        adminPassword,
        defaultDeployment: deployment,
        reconciliationMs: timeouts.reconciliationMs,
        autoAccept: options.authority?.autoAccept ?? ["initial", "update"],
        getBootstrapUrl: () =>
          startedControlPlane.waitForBootstrapUrl(timeouts.startupMs),
      });
      return new TrellisTestRuntime({
        trellisUrl: startedControlPlane.trellisUrl,
        workdir,
        deployment,
        keepWorkdir: options.keepWorkdir ?? false,
        timeouts,
        configPath,
        config,
        websocketProxy,
        controlPlaneSqlitePath: `${config.storage.dbPath}.platform`,
        trellisOptions: options.trellis,
        nats,
        controlPlane: startedControlPlane,
        admin,
      });
    } catch (error) {
      portLease?.release();
      await controlPlane?.stop().catch(() => undefined);
      websocketProxy?.stop();
      await nats?.stop().catch(() => undefined);
      if (!options.keepWorkdir) {
        await Deno.remove(workdir, { recursive: true }).catch(() => undefined);
      }
      throw error;
    }
  }

  /** @internal Starts the shared integration host after one-time authority cleanup. */
  static async startIntegrationHost(
    options: TrellisTestRuntimeStartOptions,
  ): Promise<TrellisTestRuntime> {
    const runtime = await TrellisTestRuntime.start(options);
    try {
      await runtime.#admin.resetAcceptedIntegrationAuthorities();
      return runtime;
    } catch (error) {
      await runtime.stop();
      throw error;
    }
  }

  /** Attaches worker-local clients and admin automation to a shared Trellis host. */
  static async attach(args: {
    trellisUrl: string;
    natsUrl: string;
    websocketUrl: string;
    workdir: string;
    manifest: LocalNatsBootstrapManifest;
    adminPassword: string;
    adminRpcProxy: { url: string; token: string };
    deployment: string;
    timeouts?: TrellisTestRuntimeStartOptions["timeouts"];
  }): Promise<TrellisTestRuntime> {
    const timeouts = {
      startupMs: args.timeouts?.startupMs ?? 30_000,
      reconciliationMs: args.timeouts?.reconciliationMs ?? 5_000,
      waitForMs: args.timeouts?.waitForMs ?? 5_000,
      shutdownMs: args.timeouts?.shutdownMs ?? 5_000,
    };
    const nats = await NatsTestContainer.attach({
      workdir: args.workdir,
      natsUrl: args.natsUrl,
      websocketUrl: args.websocketUrl,
      manifest: args.manifest,
    });
    const admin = new TrellisTestAdminAutomation({
      trellisUrl: args.trellisUrl,
      adminPassword: args.adminPassword,
      defaultDeployment: args.deployment,
      reconciliationMs: timeouts.reconciliationMs,
      autoAccept: ["initial", "update"],
      getBootstrapUrl: () =>
        Promise.reject(new Error("shared host is already bootstrapped")),
      bootstrapComplete: true,
      rpcProxy: args.adminRpcProxy,
    });
    const runtime = new TrellisTestRuntime({
      trellisUrl: args.trellisUrl,
      workdir: args.workdir,
      deployment: args.deployment,
      keepWorkdir: true,
      ownsWorkdir: false,
      timeouts,
      nats,
      admin,
    });
    return runtime;
  }

  /** @internal Forwards one low-level Auth RPC over the host admin session. */
  callAdminRpc(method: string, input: unknown): Promise<unknown> {
    return this.#admin.callAdminRpc(method, input);
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
    const approved = await this.#admin.approveContract({
      deployment: `${this.#deployment}.client.${args.name}`,
      contract: args.contract,
    });
    const seed = args.sessionKeySeed ?? generateSessionSeed();
    const auth = await createAuth({ sessionKeySeed: seed });
    return {
      seed,
      sessionKey: auth.sessionKey,
      participantId: approved.participantId,
      participantArtifactDigest: approved.participantDigest,
      participantNeedsDigest: approved.participantNeedsDigest,
    };
  }

  /**
   * Returns auth options and admin-backed auth continuation for a registered
   * app/client participant. Spread the result into `TrellisClient.connect(...)`.
   */
  clientAuth(key: TrellisTestClientKey): TrellisTestClientAuth {
    return {
      auth: {
        mode: "session_key",
        authorizationContextEphemeral: true,
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
    TContract extends TrellisTestClientContract,
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
      participant: {
        id: key.participantId,
        artifactDigest: key.participantArtifactDigest,
      },
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
    const TEvents extends readonly TrellisTestEventAction[],
  >(
    args: TrellisTestEventCaptureOptions<TContract, TEvents>,
  ): Promise<TrellisTestEventCapture<TEvents[number]>> {
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

  /** Seeds one raw state KV entry for malformed-entry tests. */
  async seedRawStateEntry(args: TrellisTestRawStateEntry): Promise<void> {
    const nc = await connect({
      servers: this.#nats.natsUrl,
      authenticator: credsAuthenticator(
        await Deno.readFile(
          join(this.workdir, "nats", "creds", "auth-auth.creds"),
        ),
      ),
    });
    try {
      const kv = await new Kvm(nc).open("trellis_state");
      await kv.put(args.key, JSON.stringify(args.value));
    } finally {
      await nc.close().catch(() => undefined);
    }
  }

  /** Publish one synthetic immutable revocation for live provider-watch tests. */
  async publishAuthorizationRevocation(
    contextDigest: string,
    value: Record<string, unknown>,
  ): Promise<void> {
    const store = await new Kvm(this.#nats.nc).open(
      "trellis_authorization_contexts",
    );
    await store.put(
      `revocation.${contextDigest}`,
      new TextEncoder().encode(JSON.stringify(value)),
    );
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
    if (
      this.#controlPlane === undefined || this.#configPath === undefined ||
      this.#trellisOptions === undefined
    ) {
      throw new Error("Cannot restart an attached Trellis test runtime");
    }

    await this.#admin.prepareForControlPlaneRestart();
    await this.#controlPlane.stop();
    const port = Number(new URL(this.trellisUrl).port);
    const portLease = reserveLocalPort(port);
    this.#controlPlane = await startTrellisProcess({
      trellisUrl: this.trellisUrl,
      configPath: this.#configPath,
      options: this.#trellisOptions,
      startupTimeoutMs: this.#timeouts.startupMs,
      shutdownTimeoutMs: this.#timeouts.shutdownMs,
      portLease,
    });
  }

  /** Replaces the browser WebSocket endpoint and retires the prior listener. */
  async rotateWebsocketProxy(): Promise<[string, string]> {
    if (
      this.#websocketProxy === undefined || this.#config === undefined ||
      this.#configPath === undefined
    ) {
      throw new Error("Runtime was not started with rotatableWebsocketProxy");
    }
    const retired = this.#websocketProxy;
    const replacement = TcpProxy.start(this.#nats.websocketUrl);
    this.#config.client.natsServers = [replacement.url];
    this.#config.web.allowInsecureOrigins = [
      ...this.#config.web.allowInsecureOrigins.filter((origin) =>
        origin !== retired.url
      ),
      replacement.url,
    ];
    await writeTrellisConfig({
      workdir: this.workdir,
      config: this.#config,
      configPath: this.#configPath,
    });
    await this.restartControlPlane();
    this.#websocketProxy = replacement;
    retired.stop();
    return [retired.url, replacement.url];
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
      await this.#controlPlane?.stop();
    } catch (error) {
      failures.push(error);
    }
    this.#websocketProxy?.stop();
    try {
      await this.#nats.stop();
    } catch (error) {
      failures.push(error);
    }
    if (this.#ownsWorkdir && !this.#keepWorkdir) {
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

  /** @internal Returns recent control-plane process output for test failures. */
  controlPlaneOutput(): string {
    return this.#controlPlane?.outputTails() ?? "";
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.stop();
  }
}
