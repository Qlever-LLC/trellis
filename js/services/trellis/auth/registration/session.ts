import { createKick } from "../callout/kick.ts";
import { createServiceLookup } from "../admin/service_lookup.ts";
import {
  createAuthConnectionsKickHandler,
  createAuthConnectionsListHandler,
  createAuthSessionsListHandler,
  createAuthSessionsLogoutHandler,
  createAuthSessionsMeHandler,
  createAuthRequestsValidateHandler,
} from "../session/rpc.ts";
import { createAuthSessionsRevokeHandler } from "../session/revoke.ts";
import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import type {
  SqlIdentityEnvelopeRepository,
  SqlDeviceActivationRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
  SqlSessionRepository,
  SqlUserProjectionRepository,
} from "../storage.ts";
import type { RpcRegistrar } from "./types.ts";

type RevokeSessionHandler = ReturnType<typeof createAuthSessionsRevokeHandler>;
type RevokeSessionEnvelope = Parameters<RevokeSessionHandler> extends [
  infer Input,
  infer Context,
] ? { input: Input; context: Context }
  : never;

export async function registerSessionRpcs(deps: {
  trellis: RpcRegistrar & AuthRuntimeDeps["trellis"];
  sessionStorage: SqlSessionRepository;
  userStorage: SqlUserProjectionRepository;
  contractApprovalStorage: SqlIdentityEnvelopeRepository;
  deviceActivationStorage: SqlDeviceActivationRepository;
  deviceDeploymentStorage: SqlDeviceDeploymentRepository;
  deviceInstanceStorage: SqlDeviceInstanceRepository;
  serviceDeploymentStorage: SqlServiceDeploymentRepository;
  serviceInstanceStorage: SqlServiceInstanceRepository;
  connectionsKV: AuthRuntimeDeps["connectionsKV"];
  natsAuth: AuthRuntimeDeps["natsAuth"];
  logger: AuthRuntimeDeps["logger"];
}): Promise<void> {
  const kick = createKick({ logger: deps.logger, natsAuth: deps.natsAuth });
  const serviceLookup = createServiceLookup(deps);
  const revokeSessionHandler = createAuthSessionsRevokeHandler({
    sessionStorage: deps.sessionStorage,
    connectionsKV: deps.connectionsKV,
    contractApprovalStorage: deps.contractApprovalStorage,
    deviceActivationStorage: deps.deviceActivationStorage,
    serviceInstanceStorage: deps.serviceInstanceStorage,
    kick,
    publishSessionRevoked: async (event) => {
      (await deps.trellis.publish("Auth.Sessions.Revoked", event)).inspectErr(
        (error: unknown) =>
          deps.logger.warn(
            { error },
            "Failed to publish Auth.Sessions.Revoked",
          ),
      );
    },
  });

  await deps.trellis.mount(
    "Auth.Sessions.Me",
    createAuthSessionsMeHandler({
      logger: deps.logger,
      sessionStorage: deps.sessionStorage,
      userStorage: deps.userStorage,
      deviceActivationStorage: deps.deviceActivationStorage,
      deviceInstanceStorage: deps.deviceInstanceStorage,
      deviceDeploymentStorage: deps.deviceDeploymentStorage,
      loadServiceInstance: serviceLookup.loadServiceInstanceByKey,
      loadServiceDeployment: serviceLookup.loadServiceDeployment,
    }),
  );
  await deps.trellis.mount(
    "Auth.Requests.Validate",
    createAuthRequestsValidateHandler({
      logger: deps.logger,
      sessionStorage: deps.sessionStorage,
      userStorage: deps.userStorage,
      deviceActivationStorage: deps.deviceActivationStorage,
      deviceDeploymentStorage: deps.deviceDeploymentStorage,
      deviceInstanceStorage: deps.deviceInstanceStorage,
      loadServiceInstance: serviceLookup.loadServiceInstanceByKey,
      loadServiceDeployment: serviceLookup.loadServiceDeployment,
    }),
  );
  await deps.trellis.mount(
    "Auth.Sessions.Logout",
    createAuthSessionsLogoutHandler({
      logger: deps.logger,
      sessionStorage: deps.sessionStorage,
      connectionsKV: deps.connectionsKV,
      natsAuth: deps.natsAuth,
    }),
  );
  await deps.trellis.mount(
    "Auth.Sessions.List",
    createAuthSessionsListHandler({
      logger: deps.logger,
      sessionStorage: deps.sessionStorage,
    }),
  );
  await deps.trellis.mount(
    "Auth.Sessions.Revoke",
    ({ input, context }: RevokeSessionEnvelope) =>
      revokeSessionHandler(input, context),
  );
  await deps.trellis.mount(
    "Auth.Connections.List",
    createAuthConnectionsListHandler({
      logger: deps.logger,
      sessionStorage: deps.sessionStorage,
      connectionsKV: deps.connectionsKV,
    }),
  );
  await deps.trellis.mount(
    "Auth.Connections.Kick",
    createAuthConnectionsKickHandler({
      logger: deps.logger,
      kick,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
      trellis: deps.trellis,
    }),
  );
}
