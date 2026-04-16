import { Result } from "@qlever-llc/result";
import { AuthError } from "../../../../packages/trellis/errors/AuthError.ts";

export type RenewBindingTokenRequest = {
  contractDigest: string;
};

export type RenewBindingTokenBoundResponse = {
  status: "bound";
  bindingToken: string;
  inboxPrefix: string;
  expires: string;
  sentinel: { jwt: string; seed: string };
  transports: {
    native?: { natsServers: string[] };
    websocket?: { natsServers: string[] };
  };
};

export type RenewBindingTokenResponse =
  | RenewBindingTokenBoundResponse
  | { status: "contract_changed" };

export type RenewBindingSession = {
  contractDigest: string;
  trellisId: string;
};

export function createAuthRenewBindingTokenHandler(deps: {
  loadUserSession: (
    sessionKey: string,
    trellisId: string,
  ) => Promise<RenewBindingSession | null>;
  issueBindingToken: (sessionKey: string) => Promise<RenewBindingTokenBoundResponse>;
}) {
  return async (
    req: RenewBindingTokenRequest,
    args: { caller: { trellisId?: string }; sessionKey: string },
  ) => {
    const trellisId = args.caller.trellisId;
    if (!trellisId) {
      return Result.err(new AuthError({ reason: "insufficient_permissions" }));
    }

    const session = await deps.loadUserSession(args.sessionKey, trellisId);
    if (!session) {
      return Result.err(
        new AuthError({
          reason: "session_not_found",
          context: { sessionKey: args.sessionKey },
        }),
      );
    }

    if (session.contractDigest !== req.contractDigest) {
      return Result.ok<RenewBindingTokenResponse>({ status: "contract_changed" });
    }

    return Result.ok<RenewBindingTokenResponse>(
      await deps.issueBindingToken(args.sessionKey),
    );
  };
}
