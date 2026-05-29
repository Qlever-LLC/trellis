import { createKick } from "../callout/kick.ts";
import { createServiceLookup } from "../admin/service_lookup.ts";
import {
  createAuthConnectionsKickHandler,
  createAuthConnectionsListHandler,
  createAuthHealthHandler,
  createAuthRequestsValidateHandler,
  createAuthSessionsListHandler,
  createAuthSessionsLogoutHandler,
  createAuthSessionsMeHandler,
} from "../session/rpc.ts";
import { createAuthSessionsRevokeHandler } from "../session/revoke.ts";
import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import type { IdentityGrantRecord } from "../schemas.ts";
import type {
  SqlCapabilityGroupRepository,
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
  capabilityGroupStorage: SqlCapabilityGroupRepository;
  contractApprovalStorage: {
    get(
      identityGrantId: string,
    ): Promise<IdentityGrantRecord | undefined>;
    delete(identityGrantId: string): Promise<void>;
  };
  deviceActivationStorage: SqlDeviceActivationRepository;
  deviceDeploymentStorage: SqlDeviceDeploymentRepository;
  deviceInstanceStorage: SqlDeviceInstanceRepository;
  serviceDeploymentStorage: SqlServiceDeploymentRepository;
  serviceInstanceStorage: SqlServiceInstanceRepository;
  connectionsKV: AuthRuntimeDeps["connectionsKV"];
  natsAuth: AuthRuntimeDeps["natsAuth"];
  natsSystem: AuthRuntimeDeps["natsSystem"];
  logger: AuthRuntimeDeps["logger"];
}): Promise<void> {
  const kick = createKick({ logger: deps.logger, natsSystem: deps.natsSystem });
  const serviceLookup = createServiceLookup(deps);
  const revokeSessionHandler = createAuthSessionsRevokeHandler({
    sessionStorage: deps.sessionStorage,
    connectionsKV: deps.connectionsKV,
    contractApprovalStorage: deps.contractApprovalStorage,
    deviceActivationStorage: deps.deviceActivationStorage,
    serviceInstanceStorage: deps.serviceInstanceStorage,
    kick,
    publishSessionRevoked: async (event) => {
      (await deps.trellis.event.auth.sessionsRevoked.publish(event)).inspectErr(
        (error: unknown) =>
          deps.logger.warn(
            { error },
            "Failed to publish Auth.Sessions.Revoked",
          ),
      );
    },
  });

  await deps.trellis.handle.rpc.auth.health(
    createAuthHealthHandler({ logger: deps.logger }),
  );
  await deps.trellis.handle.rpc.auth.sessionsMe(
    createAuthSessionsMeHandler({
      logger: deps.logger,
      sessionStorage: deps.sessionStorage,
      userStorage: deps.userStorage,
      capabilityGroupStorage: deps.capabilityGroupStorage,
      deviceActivationStorage: deps.deviceActivationStorage,
      deviceInstanceStorage: deps.deviceInstanceStorage,
      deviceDeploymentStorage: deps.deviceDeploymentStorage,
      loadServiceInstance: serviceLookup.loadServiceInstanceByKey,
      loadServiceDeployment: serviceLookup.loadServiceDeployment,
    }),
  );
  await deps.trellis.handle.rpc.auth.requestsValidate(
    createAuthRequestsValidateHandler({
      logger: deps.logger,
      sessionStorage: deps.sessionStorage,
      userStorage: deps.userStorage,
      capabilityGroupStorage: deps.capabilityGroupStorage,
      deviceActivationStorage: deps.deviceActivationStorage,
      deviceDeploymentStorage: deps.deviceDeploymentStorage,
      deviceInstanceStorage: deps.deviceInstanceStorage,
      loadServiceInstance: serviceLookup.loadServiceInstanceByKey,
      loadServiceDeployment: serviceLookup.loadServiceDeployment,
    }),
  );
  await deps.trellis.handle.rpc.auth.sessionsLogout(
    createAuthSessionsLogoutHandler({
      logger: deps.logger,
      sessionStorage: deps.sessionStorage,
      connectionsKV: deps.connectionsKV,
      natsSystem: deps.natsSystem,
    }),
  );
  await deps.trellis.handle.rpc.auth.sessionsList(
    createAuthSessionsListHandler({
      logger: deps.logger,
      sessionStorage: deps.sessionStorage,
    }),
  );
  await deps.trellis.handle.rpc.auth.sessionsRevoke(
    ({ input, context }: RevokeSessionEnvelope) =>
      revokeSessionHandler(input, context),
  );
  await deps.trellis.handle.rpc.auth.connectionsList(
    createAuthConnectionsListHandler({
      logger: deps.logger,
      sessionStorage: deps.sessionStorage,
      connectionsKV: deps.connectionsKV,
    }),
  );
  await deps.trellis.handle.rpc.auth.connectionsKick(
    createAuthConnectionsKickHandler({
      logger: deps.logger,
      kick,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
      trellis: deps.trellis,
    }),
  );
}
