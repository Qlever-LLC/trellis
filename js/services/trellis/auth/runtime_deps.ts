import type { AsyncResult, BaseError, Result } from "@qlever-llc/result";
import type { NatsConnection } from "@nats-io/transport-deno";
import type { Msg } from "@nats-io/nats-core";
import type { Connection, SentinelCreds } from "./schemas.ts";
import type {
  SqlCapabilityGroupRepository,
  SqlDeploymentPortalRouteRepository,
  SqlDeviceActivationRepository,
  SqlDeviceActivationReviewRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlDeviceProvisioningSecretRepository,
  SqlIdentityGrantRepository,
  SqlImplementationOfferRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
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

type RuntimeEventPublisher = {
  publish(payload: Record<string, unknown>): AsyncResult<unknown, BaseError>;
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
  natsSystem: {
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
    event: {
      auth: {
        connectionsClosed: RuntimeEventPublisher;
        connectionsKicked: RuntimeEventPublisher;
        connectionsOpened: RuntimeEventPublisher;
        deviceUserAuthoritiesApproved: RuntimeEventPublisher;
        deviceUserAuthoritiesRequested: RuntimeEventPublisher;
        deviceUserAuthoritiesResolved: RuntimeEventPublisher;
        deviceUserAuthoritiesReviewRequested: RuntimeEventPublisher;
        sessionsRevoked: RuntimeEventPublisher;
      };
    };
  };
  identityGrantStorage: SqlIdentityGrantRepository;
  capabilityGroupStorage: SqlCapabilityGroupRepository;
  deploymentPortalRouteStorage: SqlDeploymentPortalRouteRepository;
  deviceActivationReviewStorage: SqlDeviceActivationReviewRepository;
  deviceActivationStorage: SqlDeviceActivationRepository;
  deviceInstanceStorage: SqlDeviceInstanceRepository;
  deviceDeploymentStorage: SqlDeviceDeploymentRepository;
  deviceProvisioningSecretStorage: SqlDeviceProvisioningSecretRepository;
  serviceInstanceStorage: SqlServiceInstanceRepository;
  serviceDeploymentStorage: SqlServiceDeploymentRepository;
  sessionStorage: SqlSessionRepository;
  implementationOfferStorage: SqlImplementationOfferRepository;
  userStorage: SqlUserProjectionRepository;
};
