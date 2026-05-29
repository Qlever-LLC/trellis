import {
  createAuthIdentitiesGrantsListHandler,
  createAuthIdentitiesListHandler,
  createAuthIdentityGrantsRevokeHandler,
} from "../approval/rpc.ts";
import { createKick } from "../callout/kick.ts";
import {
  createAuthUsersIdentityLinkCreateHandler,
  createAuthUsersPasswordChangeHandler,
  createAuthUsersPasswordResetCreateHandler,
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
import type { IdentityGrantRecord } from "../schemas.ts";
import type {
  BoundedListQuery,
  ListPage,
  SqlAccountFlowRepository,
  SqlCapabilityGroupRepository,
  SqlLocalCredentialRepository,
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
  localCredentialStorage: SqlLocalCredentialRepository;
  contractApprovalStorage: {
    get(
      identityGrantId: string,
    ): Promise<IdentityGrantRecord | undefined>;
    delete(identityGrantId: string): Promise<void>;
    listCountedPage(
      query: BoundedListQuery,
    ): Promise<ListPage<IdentityGrantRecord>>;
    listCountedPageByUser(
      userTrellisId: string,
      query: BoundedListQuery,
    ): Promise<ListPage<IdentityGrantRecord>>;
    listApprovedCountedPageByUser(
      userTrellisId: string,
      query: BoundedListQuery,
    ): Promise<ListPage<IdentityGrantRecord>>;
  };
}): Promise<void> {
  const kick = createKick(deps);
  const portalBaseUrl = deps.config.web.publicOrigin ??
    deps.config.oauth.redirectBase;
  const listIdentities = createAuthIdentitiesListHandler({
    contractApprovalStorage: deps.contractApprovalStorage,
    logger: deps.logger,
  });
  const listIdentityGrants = createAuthIdentitiesGrantsListHandler({
    contractApprovalStorage: deps.contractApprovalStorage,
  });
  const revokeIdentityGrant = createAuthIdentityGrantsRevokeHandler({
    connectionsKV: deps.connectionsKV,
    contractApprovalStorage: deps.contractApprovalStorage,
    kick,
    logger: deps.logger,
    publishSessionRevoked: deps.publishSessionRevoked,
    sessionStorage: deps.sessionStorage,
  });
  await deps.trellis.handle.rpc.auth.identitiesList(async (args) => {
    return await listIdentities(args);
  });
  await deps.trellis.handle.rpc.auth.identityGrantsList(async (args) => {
    return await listIdentityGrants(args);
  });
  await deps.trellis.handle.rpc.auth.identityGrantsRevoke(async (args) => {
    return await revokeIdentityGrant({
      ...args,
    });
  });

  await deps.trellis.handle.rpc.auth.usersList(
    createAuthUsersListHandler(
      deps.accountStorage,
      deps.userIdentityStorage,
      deps.logger,
    ),
  );
  await deps.trellis.handle.rpc.auth.usersGet(
    createAuthUsersGetHandler(
      deps.accountStorage,
      deps.userIdentityStorage,
      deps.logger,
    ),
  );
  await deps.trellis.handle.rpc.auth.usersCreate(
    createAuthUsersCreateHandler(deps.accountStorage, deps.logger),
  );
  await deps.trellis.handle.rpc.auth.capabilitiesList(
    createAuthCapabilitiesListHandler(deps.contracts, deps.logger),
  );
  await deps.trellis.handle.rpc.auth.capabilityGroupsList(
    createAuthCapabilityGroupsListHandler(
      deps.capabilityGroupStorage,
      deps.logger,
    ),
  );
  await deps.trellis.handle.rpc.auth.capabilityGroupsGet(
    createAuthCapabilityGroupsGetHandler(
      deps.capabilityGroupStorage,
      deps.logger,
    ),
  );
  await deps.trellis.handle.rpc.auth.capabilityGroupsPut(
    createAuthCapabilityGroupsPutHandler(
      deps.capabilityGroupStorage,
      deps.contracts,
      deps.logger,
    ),
  );
  await deps.trellis.handle.rpc.auth.capabilityGroupsDelete(
    createAuthCapabilityGroupsDeleteHandler(
      deps.capabilityGroupStorage,
      deps.logger,
    ),
  );
  await deps.trellis.handle.rpc.auth.usersUpdate(
    createAuthUsersUpdateHandler(
      deps.accountStorage,
      deps.logger,
      deps.capabilityGroupStorage,
    ),
  );
  await deps.trellis.handle.rpc.auth.userIdentitiesList(
    createAuthUserIdentitiesListHandler(
      deps.accountStorage,
      deps.userIdentityStorage,
      deps.logger,
    ),
  );
  await deps.trellis.handle.rpc.auth.userIdentitiesUnlink(
    createAuthUserIdentitiesUnlinkHandler(
      deps.accountStorage,
      deps.userIdentityStorage,
      deps.logger,
      deps.capabilityGroupStorage,
    ),
  );
  await deps.trellis.handle.rpc.auth.usersIdentityLinkCreate(
    createAuthUsersIdentityLinkCreateHandler({
      accountStorage: deps.accountStorage,
      accountFlowStorage: deps.accountFlowStorage,
      logger: deps.logger,
      portalBaseUrl,
    }),
  );
  await deps.trellis.handle.rpc.auth.usersPasswordChange(
    createAuthUsersPasswordChangeHandler({
      accountStorage: deps.accountStorage,
      userIdentityStorage: deps.userIdentityStorage,
      localCredentialStorage: deps.localCredentialStorage,
      sessionStorage: deps.sessionStorage,
      connectionsKV: deps.connectionsKV,
      kick,
      publishSessionRevoked: deps.publishSessionRevoked,
      logger: deps.logger,
      passwordMinLength:
        deps.config.auth.localIdentity.passwordPolicy.minLength,
    }),
  );
  await deps.trellis.handle.rpc.auth.usersPasswordResetCreate(
    createAuthUsersPasswordResetCreateHandler({
      accountStorage: deps.accountStorage,
      userIdentityStorage: deps.userIdentityStorage,
      accountFlowStorage: deps.accountFlowStorage,
      logger: deps.logger,
      portalBaseUrl,
    }),
  );
}
