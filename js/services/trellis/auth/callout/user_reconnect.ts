import type { ContractStore } from "../../catalog/store.ts";
import type {
  ContractApprovalRecord,
  InstanceGrantPolicy,
  UserSession,
} from "../schemas.ts";
import type { UserProjectionEntry } from "../schemas.ts";
import { planUserContractApproval } from "../approval/plan.ts";
import {
  effectiveApproval,
  effectiveCapabilities,
  matchingInstanceGrantPolicies,
  missingCapabilities,
} from "../grants/policy.ts";
import { contractApprovalKey } from "../http/support.ts";

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
  contractStore: ContractStore;
  loadUserProjection: (
    trellisId: string,
  ) => Promise<UserProjectionEntry | null>;
  loadStoredApproval: (key: string) => Promise<ContractApprovalRecord | null>;
  loadInstanceGrantPolicies: (
    contractId: string,
  ) => Promise<InstanceGrantPolicy[]>;
}): Promise<ResolveUserReconnectResult> {
  const knownContract = args.contractStore.getKnownContract(
    args.presentedContractDigest,
  );
  const expectedContractId = args.session.app?.contractId ??
    args.session.contractId;
  if (!knownContract || knownContract.id !== expectedContractId) {
    return { ok: false, reason: "contract_changed" };
  }

  const projection = await args.loadUserProjection(args.session.trellisId);
  if (!projection) {
    return { ok: false, reason: "user_not_found" };
  }
  if (!projection.active) {
    return { ok: false, reason: "user_inactive" };
  }

  const plan = await planUserContractApproval(
    args.contractStore,
    knownContract,
  );
  if (
    plan.digest !== args.presentedContractDigest ||
    plan.contract.id !== expectedContractId
  ) {
    return { ok: false, reason: "contract_changed" };
  }

  const matchedPolicies = matchingInstanceGrantPolicies({
    policies: await args.loadInstanceGrantPolicies(plan.contract.id),
    contractId: plan.contract.id,
    appOrigin: args.session.app?.origin,
  });
  const storedApproval = await args.loadStoredApproval(
    contractApprovalKey(args.session.trellisId, plan.digest),
  );
  const resolvedApproval = effectiveApproval({
    storedApproval,
    matchedPolicies,
  });
  const resolvedCapabilities = effectiveCapabilities({
    explicitCapabilities: projection.capabilities ?? [],
    matchedPolicies,
  });

  if (resolvedApproval.answer !== "approved") {
    return { ok: false, reason: "approval_required" };
  }
  if (
    missingCapabilities({
      requiredCapabilities: plan.approval.capabilities,
      effectiveCapabilities: resolvedCapabilities,
    }).length > 0
  ) {
    return { ok: false, reason: "insufficient_permissions" };
  }

  return {
    ok: true,
    session: {
      ...args.session,
      contractDigest: plan.digest,
      contractId: plan.contract.id,
      contractDisplayName: plan.contract.displayName,
      contractDescription: plan.contract.description,
      approvalSource: resolvedApproval.kind,
      delegatedCapabilities: plan.approval.capabilities,
      delegatedPublishSubjects: plan.publishSubjects,
      delegatedSubscribeSubjects: plan.subscribeSubjects,
    },
  };
}
