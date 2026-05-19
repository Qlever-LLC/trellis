import {
  createAuthIdentitiesGrantsListHandler,
  createAuthIdentitiesListHandler,
  createAuthIdentityEnvelopesRevokeHandler,
} from "../approval/rpc.ts";
import { createKick } from "../callout/kick.ts";
import {
  createAuthAccountFlowsCreateIdentityLinkHandler,
  createAuthAccountFlowsCreateInviteHandler,
  createAuthAccountFlowsCreatePasswordResetHandler,
  createAuthAccountFlowsCreatePasswordSetupHandler,
} from "../session/account_flows.ts";
import {
  createAuthCapabilitiesListHandler,
  createAuthCapabilityGroupsDeleteHandler,
  createAuthCapabilityGroupsGetHandler,
  createAuthCapabilityGroupsListHandler,
  createAuthCapabilityGroupsPutHandler,
  createAuthUserIdentitiesListHandler,
  createAuthUserIdentitiesUnlinkHandler,
  createAuthUsersCreateHandler,
  createAuthUsersGetHandler,
  createAuthUsersListHandler,
  createAuthUsersUpdateHandler,
} from "../session/users.ts";
import type {
  SqlAccountFlowRepository,
  SqlCapabilityGroupRepository,
  SqlIdentityEnvelopeRepository,
  SqlSessionRepository,
  SqlUserAccountRepository,
  SqlUserIdentityRepository,
} from "../storage.ts";
import type {
  AuthLogger,
  AuthRuntimeDeps,
  RuntimeKV,
} from "../runtime_deps.ts";
import type { AuthContractsRuntime, RpcRegistrar } from "./types.ts";
import type { Connection } from "../schemas.ts";
import type { Config } from "../../config.ts";

export async function registerApprovalAndUserRpcs(deps: {
  trellis: RpcRegistrar;
  config: Config;
  contracts: Pick<AuthContractsRuntime, "getActiveCapabilityDefinitions">;
  connectionsKV: RuntimeKV<Connection>;
  logger: AuthLogger;
  natsSystem: AuthRuntimeDeps["natsSystem"];
  sessionStorage: SqlSessionRepository;
  publishSessionRevoked: (
    event: {
      origin: string;
      id: string;
      sessionKey: string;
      revokedBy: string;
    },
  ) => Promise<void>;
  accountStorage: SqlUserAccountRepository;
  capabilityGroupStorage: SqlCapabilityGroupRepository;
  accountFlowStorage: SqlAccountFlowRepository;
  userIdentityStorage: SqlUserIdentityRepository;
  contractApprovalStorage: SqlIdentityEnvelopeRepository;
}): Promise<void> {
  const kick = createKick(deps);
  const portalBaseUrl = deps.config.web.publicOrigin ??
    deps.config.oauth.redirectBase;
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
    createAuthUsersListHandler(
      deps.accountStorage,
      deps.userIdentityStorage,
      deps.logger,
    ),
  );
  await deps.trellis.mount(
    "Auth.Users.Get",
    createAuthUsersGetHandler(
      deps.accountStorage,
      deps.userIdentityStorage,
      deps.logger,
    ),
  );
  await deps.trellis.mount(
    "Auth.Users.Create",
    createAuthUsersCreateHandler(deps.accountStorage, deps.logger),
  );
  await deps.trellis.mount(
    "Auth.Capabilities.List",
    createAuthCapabilitiesListHandler(deps.contracts, deps.logger),
  );
  await deps.trellis.mount(
    "Auth.CapabilityGroups.List",
    createAuthCapabilityGroupsListHandler(
      deps.capabilityGroupStorage,
      deps.logger,
    ),
  );
  await deps.trellis.mount(
    "Auth.CapabilityGroups.Get",
    createAuthCapabilityGroupsGetHandler(
      deps.capabilityGroupStorage,
      deps.logger,
    ),
  );
  await deps.trellis.mount(
    "Auth.CapabilityGroups.Put",
    createAuthCapabilityGroupsPutHandler(
      deps.capabilityGroupStorage,
      deps.contracts,
      deps.logger,
    ),
  );
  await deps.trellis.mount(
    "Auth.CapabilityGroups.Delete",
    createAuthCapabilityGroupsDeleteHandler(
      deps.capabilityGroupStorage,
      deps.logger,
    ),
  );
  await deps.trellis.mount(
    "Auth.Users.Update",
    createAuthUsersUpdateHandler(
      deps.accountStorage,
      deps.logger,
      deps.capabilityGroupStorage,
    ),
  );
  await deps.trellis.mount(
    "Auth.UserIdentities.List",
    createAuthUserIdentitiesListHandler(
      deps.accountStorage,
      deps.userIdentityStorage,
      deps.logger,
    ),
  );
  await deps.trellis.mount(
    "Auth.UserIdentities.Unlink",
    createAuthUserIdentitiesUnlinkHandler(
      deps.accountStorage,
      deps.userIdentityStorage,
      deps.logger,
      deps.capabilityGroupStorage,
    ),
  );
  await deps.trellis.mount(
    "Auth.AccountFlows.CreateInvite",
    createAuthAccountFlowsCreateInviteHandler({
      accountStorage: deps.accountStorage,
      accountFlowStorage: deps.accountFlowStorage,
      logger: deps.logger,
      portalBaseUrl,
    }),
  );
  await deps.trellis.mount(
    "Auth.AccountFlows.CreateIdentityLink",
    createAuthAccountFlowsCreateIdentityLinkHandler({
      accountStorage: deps.accountStorage,
      accountFlowStorage: deps.accountFlowStorage,
      logger: deps.logger,
      portalBaseUrl,
    }),
  );
  await deps.trellis.mount(
    "Auth.AccountFlows.CreatePasswordSetup",
    createAuthAccountFlowsCreatePasswordSetupHandler({
      accountStorage: deps.accountStorage,
      accountFlowStorage: deps.accountFlowStorage,
      logger: deps.logger,
      portalBaseUrl,
    }),
  );
  await deps.trellis.mount(
    "Auth.AccountFlows.CreatePasswordReset",
    createAuthAccountFlowsCreatePasswordResetHandler({
      accountStorage: deps.accountStorage,
      accountFlowStorage: deps.accountFlowStorage,
      logger: deps.logger,
      portalBaseUrl,
    }),
  );
}
