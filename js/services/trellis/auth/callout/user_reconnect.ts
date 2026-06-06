import type { CapabilityGroupLoader } from "../capability_groups.ts";
import { resolveCapabilities } from "../capability_groups.ts";
import type { UserProjectionEntry, UserSession } from "../schemas.ts";

export type UserReconnectFailureReason =
  | "approval_required"
  | "contract_changed"
  | "insufficient_permissions"
  | "user_inactive"
  | "user_not_found";

export type ResolveUserReconnectResult =
  | { ok: true; session: UserSession }
  | { ok: false; reason: UserReconnectFailureReason };

export async function resolveUserReconnectSession(args: {
  session: UserSession;
  presentedContractDigest: string;
  loadUserProjection: (
    userId: string,
  ) => Promise<UserProjectionEntry | null>;
  capabilityGroupStorage?: CapabilityGroupLoader;
}): Promise<ResolveUserReconnectResult> {
  if (args.presentedContractDigest !== args.session.contractDigest) {
    return { ok: false, reason: "contract_changed" };
  }

  const projection = await args.loadUserProjection(args.session.userId);
  if (!projection) {
    return { ok: false, reason: "user_not_found" };
  }
  if (!projection.active) {
    return { ok: false, reason: "user_inactive" };
  }

  const resolvedCapabilities = await resolveCapabilities(
    projection,
    args.capabilityGroupStorage,
  );
  if (
    !args.session.delegatedCapabilities.every((capability) =>
      resolvedCapabilities.includes(capability)
    )
  ) {
    return { ok: false, reason: "insufficient_permissions" };
  }

  return {
    ok: true,
    session: {
      ...args.session,
      approvalSource: args.session.approvalSource ?? "stored_approval",
    },
  };
}
