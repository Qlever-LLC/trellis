import {
  createAuthListApprovalsHandler,
  createAuthListUserGrantsHandler,
  createAuthRevokeApprovalHandler,
  createAuthRevokeUserGrantRpcHandler,
} from "../approval/rpc.ts";
import { kick } from "../callout/kick.ts";
import {
  createAuthListUsersHandler,
  createAuthUpdateUserHandler,
} from "../session/users.ts";
import type {
  SqlContractApprovalRepository,
  SqlSessionRepository,
  SqlUserProjectionRepository,
} from "../storage.ts";
import type { AuthLogger, RuntimeKV } from "../runtime_deps.ts";
import type { RpcRegistrar } from "./types.ts";
import type { Connection } from "../schemas.ts";

export async function registerApprovalAndUserRpcs(deps: {
  trellis: RpcRegistrar;
  connectionsKV: RuntimeKV<Connection>;
  logger: AuthLogger;
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
  contractApprovalStorage: SqlContractApprovalRepository;
}): Promise<void> {
  await deps.trellis.mount(
    "Auth.ListApprovals",
    createAuthListApprovalsHandler({
      contractApprovalStorage: deps.contractApprovalStorage,
    }),
  );
  await deps.trellis.mount(
    "Auth.ListUserGrants",
    createAuthListUserGrantsHandler({
      contractApprovalStorage: deps.contractApprovalStorage,
    }),
  );
  await deps.trellis.mount(
    "Auth.RevokeApproval",
    createAuthRevokeApprovalHandler({
      contractApprovalStorage: deps.contractApprovalStorage,
      kick,
    }),
  );
  await deps.trellis.mount(
    "Auth.RevokeUserGrant",
    createAuthRevokeUserGrantRpcHandler({
      connectionsKV: deps.connectionsKV,
      contractApprovalStorage: deps.contractApprovalStorage,
      kick,
      logger: deps.logger,
      publishSessionRevoked: deps.publishSessionRevoked,
      sessionStorage: deps.sessionStorage,
    }),
  );

  await deps.trellis.mount(
    "Auth.ListUsers",
    createAuthListUsersHandler(deps.userStorage, deps.logger),
  );
  await deps.trellis.mount(
    "Auth.UpdateUser",
    createAuthUpdateUserHandler(deps.userStorage, deps.logger),
  );
}
