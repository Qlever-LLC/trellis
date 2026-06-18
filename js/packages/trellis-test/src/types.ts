import type {
  ClientAuthContinuation,
  ClientAuthOptions,
  ClientAuthRequiredContext,
  ConnectedTrellisClient,
  ContractModule,
  TrellisAPI,
  TrellisApiLike,
  TrellisContractV1,
} from "@qlever-llc/trellis";

/** Serializable contract descriptor accepted by test admin automation. */
export type TrellisTestContractDescriptor = {
  readonly CONTRACT: Record<string, unknown>;
  readonly CONTRACT_DIGEST: string | undefined;
};

/** A full contract module or a descriptor carrying only the fields admin needs. */
export type TrellisTestContractLike = {
  readonly CONTRACT: Record<string, unknown>;
  readonly CONTRACT_DIGEST?: string;
} & ({ readonly __brand?: never });

/** Authority plan classifications the test runtime may approve automatically. */
export type TrellisTestAuthorityPlanClassification = "update" | "migration";

/** Polling options for `waitFor` and runtime readiness helpers. */
export type WaitForOptions = {
  timeoutMs?: number;
  intervalMs?: number;
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
  mutableDev?: boolean;
  command: TrellisTestRuntimeTrellisCommand;
};

/** Options for starting an isolated Trellis test runtime. */
export type TrellisTestRuntimeStartOptions = {
  nats?: "container";
  keepWorkdir?: boolean;
  deployment?: string;
  trellis: TrellisTestRuntimeTrellisOptions;
  authority?: {
    /**
     * Authority plan classifications the runtime admin automation may accept.
     * Defaults to `["update"]`; include `"migration"` only for isolated mutable-dev tests.
     */
    autoAccept?: readonly TrellisTestAuthorityPlanClassification[];
  };
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
  sessionKey: string;
};

/** Session-key material returned for a registered app/client participant. */
export type TrellisTestClientKey = {
  seed: string;
  sessionKey: string;
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
};

/** Contract value accepted by the Trellis test runtime. */
export type TrellisTestContract = ContractModule<
  string,
  TrellisApiLike,
  TrellisApiLike,
  TrellisApiLike
>;

/** Contract value accepted by app/client helpers. */
export type TrellisTestClientContract<TApi extends TrellisAPI = TrellisAPI> = {
  CONTRACT: TrellisContractV1;
  CONTRACT_DIGEST?: string;
  API: {
    owned?: TApi;
    trellis?: TApi;
  };
};

type ApiForTestClientContract<TContract> = TContract extends {
  API: { trellis: infer TApi };
} ? TApi extends TrellisAPI ? TApi : TrellisAPI
  : TContract extends { API: { owned: infer TApi } }
    ? TApi extends TrellisAPI ? TApi : TrellisAPI
  : TrellisAPI;

/** Connected app/client type returned by `TrellisTestRuntime.connectClient`. */
export type TrellisTestConnectedClient<TContract> = ConnectedTrellisClient<
  TContract & { API: { trellis: ApiForTestClientContract<TContract> } }
>;
