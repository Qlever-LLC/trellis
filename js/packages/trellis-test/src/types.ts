import type { ContractModule, TrellisApiLike } from "@qlever-llc/trellis";

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

/** Contract value accepted by the Trellis test runtime. */
export type TrellisTestContract = ContractModule<
  string,
  TrellisApiLike,
  TrellisApiLike,
  TrellisApiLike
>;
