import {
  createAuthIdentitiesGrantsListHandler,
  createAuthIdentitiesListHandler,
  createAuthIdentityEnvelopesRevokeHandler,
} from "../approval/rpc.ts";
import { createKick } from "../callout/kick.ts";
import {
  createAuthCapabilitiesListHandler,
  createAuthUsersListHandler,
  createAuthUsersUpdateHandler,
} from "../session/users.ts";
import type {
  SqlIdentityEnvelopeRepository,
  SqlSessionRepository,
  SqlUserProjectionRepository,
} from "../storage.ts";
import type {
  AuthLogger,
  AuthRuntimeDeps,
  RuntimeKV,
} from "../runtime_deps.ts";
import type { AuthContractsRuntime, RpcRegistrar } from "./types.ts";
import type { Connection } from "../schemas.ts";

export async function registerApprovalAndUserRpcs(deps: {
  trellis: RpcRegistrar;
  contracts: Pick<AuthContractsRuntime, "getActiveCapabilityDefinitions">;
  connectionsKV: RuntimeKV<Connection>;
  logger: AuthLogger;
  natsAuth: AuthRuntimeDeps["natsAuth"];
  sessionStorage: SqlSessionRepository;
  publishSessionRevoked: (
    event: {
      origin: string;
      id: string;
      sessionKey: string;
      revokedBy: string;
    },
  ) => Promise<void>;
  userStorage: SqlUserProjectionRepository;
  contractApprovalStorage: SqlIdentityEnvelopeRepository;
}): Promise<void> {
  const kick = createKick(deps);
  await deps.trellis.mount(
    "Auth.Identities.List",
    createAuthIdentitiesListHandler({
      contractApprovalStorage: deps.contractApprovalStorage,
      logger: deps.logger,
    }),
  );
  await deps.trellis.mount(
    "Auth.Identities.Grants.List",
    createAuthIdentitiesGrantsListHandler({
      contractApprovalStorage: deps.contractApprovalStorage,
    }),
  );
  await deps.trellis.mount(
    "Auth.IdentityEnvelopes.Revoke",
    createAuthIdentityEnvelopesRevokeHandler({
      connectionsKV: deps.connectionsKV,
      contractApprovalStorage: deps.contractApprovalStorage,
      kick,
      logger: deps.logger,
      publishSessionRevoked: deps.publishSessionRevoked,
      sessionStorage: deps.sessionStorage,
    }),
  );

  await deps.trellis.mount(
    "Auth.Users.List",
    createAuthUsersListHandler(deps.userStorage, deps.logger),
  );
  await deps.trellis.mount(
    "Auth.Capabilities.List",
    createAuthCapabilitiesListHandler(deps.contracts, deps.logger),
  );
  await deps.trellis.mount(
    "Auth.Users.Update",
    createAuthUsersUpdateHandler(deps.userStorage, deps.logger),
  );
}
