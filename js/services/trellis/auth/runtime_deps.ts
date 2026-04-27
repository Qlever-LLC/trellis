import type { AsyncResult, BaseError, Result } from "@qlever-llc/result";
import type { NatsConnection } from "@nats-io/transport-deno";
import type { Msg } from "@nats-io/nats-core";
import type { Connection, SentinelCreds } from "../state/schemas.ts";
import type {
  SqlContractApprovalRepository,
  SqlDeviceActivationRepository,
  SqlDeviceActivationReviewRepository,
  SqlDeviceInstanceRepository,
  SqlDevicePortalSelectionRepository,
  SqlDeviceProfileRepository,
  SqlDeviceProvisioningSecretRepository,
  SqlInstanceGrantPolicyRepository,
  SqlLoginPortalSelectionRepository,
  SqlPortalDefaultRepository,
  SqlPortalProfileRepository,
  SqlPortalRepository,
  SqlServiceInstanceRepository,
  SqlServiceProfileRepository,
  SqlSessionRepository,
  SqlUserProjectionRepository,
} from "./storage.ts";

export type AuthLogger = {
  trace: (fields: Record<string, unknown>, message: string) => void;
  debug: (fields: Record<string, unknown>, message: string) => void;
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
  error: (fields: Record<string, unknown>, message: string) => void;
};

type RuntimeTaken<T> = T | Result<never, BaseError>;

export type RuntimeKV<Value = unknown> = {
  get(key: string): AsyncResult<RuntimeTaken<{ value: Value }>, BaseError>;
  put(key: string, value: Value): AsyncResult<RuntimeTaken<void>, BaseError>;
  create(key: string, value: Value): AsyncResult<RuntimeTaken<void>, BaseError>;
  delete(key: string): AsyncResult<RuntimeTaken<void>, BaseError>;
  keys(
    filter: string | string[],
  ): AsyncResult<RuntimeTaken<AsyncIterable<string>>, BaseError>;
};

export type AuthRuntimeDeps = {
  browserFlowsKV: RuntimeKV;
  connectionsKV: RuntimeKV<Connection>;
  logger: AuthLogger;
  natsAuth: {
    request(subject: string, payload?: string): Promise<unknown>;
    subscribe(
      subject: string,
      opts?: { queue?: string },
    ): AsyncIterable<Msg> & { unsubscribe(): void };
  };
  natsTrellis: NatsConnection;
  oauthStateKV: RuntimeKV;
  pendingAuthKV: RuntimeKV;
  sentinelCreds: SentinelCreds;
  trellis: {
    publish(
      event: string,
      payload: unknown,
    ): AsyncResult<unknown, BaseError>;
  };
  contractApprovalStorage: SqlContractApprovalRepository;
  deviceActivationReviewStorage: SqlDeviceActivationReviewRepository;
  deviceActivationStorage: SqlDeviceActivationRepository;
  deviceInstanceStorage: SqlDeviceInstanceRepository;
  devicePortalSelectionStorage: SqlDevicePortalSelectionRepository;
  deviceProfileStorage: SqlDeviceProfileRepository;
  deviceProvisioningSecretStorage: SqlDeviceProvisioningSecretRepository;
  instanceGrantPolicyStorage: SqlInstanceGrantPolicyRepository;
  loginPortalSelectionStorage: SqlLoginPortalSelectionRepository;
  portalDefaultStorage: SqlPortalDefaultRepository;
  portalProfileStorage: SqlPortalProfileRepository;
  portalStorage: SqlPortalRepository;
  serviceInstanceStorage: SqlServiceInstanceRepository;
  serviceProfileStorage: SqlServiceProfileRepository;
  sessionStorage: SqlSessionRepository;
  userStorage: SqlUserProjectionRepository;
};

let runtimeDeps: AuthRuntimeDeps | undefined;

/** Configures auth runtime dependencies from service startup wiring. */
export function setAuthRuntimeDeps(deps: AuthRuntimeDeps): void {
  runtimeDeps = deps;
}

/** Returns auth runtime dependencies configured by `registerAuth`. */
export function authRuntimeDeps(): AuthRuntimeDeps {
  if (!runtimeDeps) {
    throw new Error("Auth runtime dependencies have not been configured");
  }
  return runtimeDeps;
}

/** Returns configured auth runtime dependencies when startup wiring is active. */
export function maybeAuthRuntimeDeps(): AuthRuntimeDeps | undefined {
  return runtimeDeps;
}
