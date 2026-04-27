import { kick } from "../callout/kick.ts";
import {
  authListConnectionsHandler,
  authListSessionsHandler,
  authLogoutHandler,
  authMeHandler,
  authRevokeSessionHandler,
  createAuthKickConnectionHandler,
  createAuthValidateRequestHandler,
} from "../session/rpc.ts";
import type {
  SqlContractApprovalRepository,
  SqlSessionRepository,
  SqlUserProjectionRepository,
} from "../storage.ts";
import type { RpcRegistrar } from "./types.ts";

type RevokeSessionEnvelope = Parameters<typeof authRevokeSessionHandler> extends
  [infer Input, infer Context] ? { input: Input; context: Context }
  : never;

export async function registerSessionRpcs(deps: {
  trellis: RpcRegistrar;
  sessionStorage: SqlSessionRepository;
  userStorage: SqlUserProjectionRepository;
  contractApprovalStorage: SqlContractApprovalRepository;
}): Promise<void> {
  await deps.trellis.mount("Auth.Me", authMeHandler);
  await deps.trellis.mount(
    "Auth.ValidateRequest",
    createAuthValidateRequestHandler({
      sessionStorage: deps.sessionStorage,
      userStorage: deps.userStorage,
      contractApprovalStorage: deps.contractApprovalStorage,
    }),
  );
  await deps.trellis.mount("Auth.Logout", authLogoutHandler);
  await deps.trellis.mount("Auth.ListSessions", authListSessionsHandler);
  await deps.trellis.mount(
    "Auth.RevokeSession",
    ({ input, context }: RevokeSessionEnvelope) =>
      authRevokeSessionHandler(input, context),
  );
  await deps.trellis.mount("Auth.ListConnections", authListConnectionsHandler);
  await deps.trellis.mount(
    "Auth.KickConnection",
    createAuthKickConnectionHandler({ kick }),
  );
}
