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
  SqlUserProjectionRepository,
} from "../storage.ts";
import type { RpcRegistrar } from "./types.ts";

export async function registerApprovalAndUserRpcs(deps: {
  trellis: RpcRegistrar;
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
      contractApprovalStorage: deps.contractApprovalStorage,
      kick,
    }),
  );

  await deps.trellis.mount(
    "Auth.ListUsers",
    createAuthListUsersHandler(deps.userStorage),
  );
  await deps.trellis.mount(
    "Auth.UpdateUser",
    createAuthUpdateUserHandler(deps.userStorage),
  );
}
