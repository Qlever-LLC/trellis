import type {
  CallerContract,
  CallerRuntime,
  ClientAuthContinuation,
  ClientAuthOptions,
  ClientAuthRequiredContext,
} from "@qlever-llc/trellis";
import type { NativeProtocolContract } from "@qlever-llc/trellis/contracts";

import type {
  TrellisControlPlaneOAuthProvider,
  TrellisControlPlaneWebSource,
} from "./control_plane_config.ts";
import type { LocalNatsBootstrapManifest } from "./nats_bootstrap.ts";
import type { TrellisControlPlaneSqlite } from "./control_plane_sqlite.ts";

/** Serializable contract descriptor accepted by test admin automation. */
export type TrellisTestContractDescriptor = {
  readonly CONTRACT_ID: string;
  readonly CONTRACT_DIGEST: string;
  readonly API: Readonly<Record<string, unknown>>;
  readonly API_DIGEST: string;
  readonly PARTICIPANT: Readonly<Record<string, unknown>>;
};

/** Native contract artifacts accepted by Trellis test admin automation. */
export type TrellisTestContractLike = NativeProtocolContract;

/** Authority plan classifications the test runtime may approve automatically. */
export type TrellisTestAuthorityPlanClassification =
  | "initial"
  | "update"
  | "migration";

/** Polling options for `waitFor` and runtime readiness helpers. */
export type WaitForOptions = {
  timeoutMs?: number;
  intervalMs?: number;
};

/** Test-only handles for manipulating the isolated Trellis control plane. */
export type TrellisTestControlPlane = {
  /** Direct access to the runtime-owned control-plane SQLite database. */
  readonly sqlite: TrellisControlPlaneSqlite;
};

/** Raw auth connection-presence entry seeded for malformed live-runtime tests. */
export type TrellisTestRawAuthConnectionPresence = {
  readonly key: string;
  readonly value: Record<string, unknown>;
};

/** Raw state KV entry seeded for malformed live-runtime tests. */
export type TrellisTestRawStateEntry = {
  readonly key: string;
  readonly value: Record<string, unknown>;
};

/** Local command override for the spawned Trellis control-plane process. */
export type TrellisTestRuntimeTrellisCommand = {
  cmd: string;
  args: readonly string[];
  env?: Record<string, string>;
  cwd?: string;
};

/** Options for the Trellis control-plane started by the test runtime. */
export type TrellisTestRuntimeTrellisOptions = {
  command: TrellisTestRuntimeTrellisCommand;
};

/** Options for starting an isolated Trellis test runtime. */
export type TrellisTestRuntimeStartOptions = {
  nats?: "container" | {
    /** Shared NATS bootstrap root containing the tenant credentials. */
    workdir: string;
    /** Shared native NATS endpoint. */
    natsUrl: string;
    /** Shared websocket NATS endpoint. */
    websocketUrl: string;
    /** Credentials and account keys for this runtime's isolated tenant. */
    manifest: LocalNatsBootstrapManifest;
  };
  keepWorkdir?: boolean;
  deployment?: string;
  /** Existing or desired local test-admin password. */
  adminPassword?: string;
  trellis: TrellisTestRuntimeTrellisOptions;
  authority?: {
    /**
     * Authority plan classifications the runtime admin automation may accept.
     * Defaults to `["update"]`; include `"migration"` only for isolated mutable-dev tests.
     */
    autoAccept?: readonly TrellisTestAuthorityPlanClassification[];
  };
  /** OAuth/OIDC providers injected into the isolated test control-plane config. */
  oauthProviders?: Record<string, TrellisControlPlaneOAuthProvider>;
  /** Additional exact browser origins allowed by the test runtime. */
  webOrigins?: readonly string[];
  /** Shared built-in web source for the real control plane. */
  webSource?: TrellisControlPlaneWebSource;
  /** Login Portal source overriding the shared web source. */
  portalSource?: TrellisControlPlaneWebSource;
  /** Console source overriding the shared web source. */
  consoleSource?: TrellisControlPlaneWebSource;
  /** Route the advertised browser WebSocket endpoint through a replaceable TCP proxy. */
  rotatableWebsocketProxy?: boolean;
  timeouts?: {
    startupMs?: number;
    reconciliationMs?: number;
    waitForMs?: number;
    shutdownMs?: number;
  };
};

/** Session-key material returned for a registered service. */
export type TrellisTestServiceKey = {
  seed: string;
  sessionSeed: string;
  sessionKey: string;
  deploymentId: string;
  instanceId: string;
  participantId: string;
  participantArtifactDigest: string;
  participantNeedsDigest: string;
};

/** Session-key material returned for a registered app/client participant. */
export type TrellisTestClientKey = {
  seed: string;
  sessionKey: string;
  participantId: string;
  participantArtifactDigest: string;
  participantNeedsDigest: string;
};

/** Authentication options for connecting a test app/client participant. */
export type TrellisTestClientAuth = {
  auth: ClientAuthOptions;
  onAuthRequired(
    ctx: ClientAuthRequiredContext,
  ): Promise<ClientAuthContinuation>;
};

/** Result returned when a contract authority plan is approved by the test runtime. */
export type TrellisTestContractApproval = {
  planId: string;
  classification: TrellisTestAuthorityPlanClassification;
  participantId: string;
  participantDigest: string;
  participantNeedsDigest: string;
  deploymentId: string;
};

/** Contract value accepted by the Trellis test runtime. */
export type TrellisTestContract = TrellisTestContractLike;

/** Contract value accepted by app/client helpers. */
export type TrellisTestClientContract = CallerContract;

/** Connected app/client type returned by `TrellisTestRuntime.connectClient`. */
export type TrellisTestConnectedClient<TContract> = CallerRuntime<TContract>;
