import { createKick } from "../callout/kick.ts";
import { createServiceLookup } from "../admin/service_lookup.ts";
import { createEffectiveGrantPolicyLoader } from "../grants/store.ts";
import {
  createAuthKickConnectionHandler,
  createAuthListConnectionsHandler,
  createAuthListSessionsHandler,
  createAuthLogoutHandler,
  createAuthMeHandler,
  createAuthValidateRequestHandler,
} from "../session/rpc.ts";
import { createAuthRevokeSessionHandler } from "../session/revoke.ts";
import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import type {
  SqlContractApprovalRepository,
  SqlDeviceActivationRepository,
  SqlDeviceDeploymentRepository,
  SqlInstanceGrantPolicyRepository,
  SqlPortalProfileRepository,
  SqlPortalRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
  SqlSessionRepository,
  SqlUserProjectionRepository,
} from "../storage.ts";
import type { RpcRegistrar } from "./types.ts";

type RevokeSessionHandler = ReturnType<typeof createAuthRevokeSessionHandler>;
type RevokeSessionEnvelope = Parameters<RevokeSessionHandler> extends [
  infer Input,
  infer Context,
] ? { input: Input; context: Context }
  : never;

export async function registerSessionRpcs(deps: {
  trellis: RpcRegistrar & AuthRuntimeDeps["trellis"];
  sessionStorage: SqlSessionRepository;
  userStorage: SqlUserProjectionRepository;
  contractApprovalStorage: SqlContractApprovalRepository;
  deviceActivationStorage: SqlDeviceActivationRepository;
  deviceDeploymentStorage: SqlDeviceDeploymentRepository;
  serviceDeploymentStorage: SqlServiceDeploymentRepository;
  serviceInstanceStorage: SqlServiceInstanceRepository;
  instanceGrantPolicyStorage: SqlInstanceGrantPolicyRepository;
  portalProfileStorage: SqlPortalProfileRepository;
  portalStorage: SqlPortalRepository;
  connectionsKV: AuthRuntimeDeps["connectionsKV"];
  natsAuth: AuthRuntimeDeps["natsAuth"];
  logger: AuthRuntimeDeps["logger"];
}): Promise<void> {
  const kick = createKick({ logger: deps.logger, natsAuth: deps.natsAuth });
  const serviceLookup = createServiceLookup(deps);
  const loadInstanceGrantPolicies = createEffectiveGrantPolicyLoader(deps);
  const revokeSessionHandler = createAuthRevokeSessionHandler({
    sessionStorage: deps.sessionStorage,
    connectionsKV: deps.connectionsKV,
    contractApprovalStorage: deps.contractApprovalStorage,
    deviceActivationStorage: deps.deviceActivationStorage,
    serviceInstanceStorage: deps.serviceInstanceStorage,
    kick,
    publishSessionRevoked: async (event) => {
      (await deps.trellis.publish("Auth.SessionRevoked", event)).inspectErr(
        (error: unknown) =>
          deps.logger.warn(
            { error },
            "Failed to publish Auth.SessionRevoked",
          ),
      );
    },
  });

  await deps.trellis.mount(
    "Auth.Me",
    createAuthMeHandler({
      sessionStorage: deps.sessionStorage,
      userStorage: deps.userStorage,
      deviceActivationStorage: deps.deviceActivationStorage,
      deviceDeploymentStorage: deps.deviceDeploymentStorage,
      loadServiceInstance: serviceLookup.loadServiceInstanceByKey,
      loadServiceDeployment: serviceLookup.loadServiceDeployment,
    }),
  );
  await deps.trellis.mount(
    "Auth.ValidateRequest",
    createAuthValidateRequestHandler({
      sessionStorage: deps.sessionStorage,
      userStorage: deps.userStorage,
      contractApprovalStorage: deps.contractApprovalStorage,
      deviceActivationStorage: deps.deviceActivationStorage,
      deviceDeploymentStorage: deps.deviceDeploymentStorage,
      loadServiceInstance: serviceLookup.loadServiceInstanceByKey,
      loadServiceDeployment: serviceLookup.loadServiceDeployment,
      loadInstanceGrantPolicies,
    }),
  );
  await deps.trellis.mount(
    "Auth.Logout",
    createAuthLogoutHandler({
      sessionStorage: deps.sessionStorage,
      connectionsKV: deps.connectionsKV,
      natsAuth: deps.natsAuth,
    }),
  );
  await deps.trellis.mount(
    "Auth.ListSessions",
    createAuthListSessionsHandler({ sessionStorage: deps.sessionStorage }),
  );
  await deps.trellis.mount(
    "Auth.RevokeSession",
    ({ input, context }: RevokeSessionEnvelope) =>
      revokeSessionHandler(input, context),
  );
  await deps.trellis.mount(
    "Auth.ListConnections",
    createAuthListConnectionsHandler({
      sessionStorage: deps.sessionStorage,
      connectionsKV: deps.connectionsKV,
    }),
  );
  await deps.trellis.mount(
    "Auth.KickConnection",
    createAuthKickConnectionHandler({
      kick,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
      trellis: deps.trellis,
    }),
  );
}
