import { approvalCapabilityKeys } from "@qlever-llc/trellis/auth";

import type { ContractsModule } from "../../catalog/runtime.ts";
import type { CapabilityGroupLoader } from "../capability_groups.ts";
import { resolveCapabilities } from "../capability_groups.ts";
import type { EnvelopeBoundary, UserSession } from "../schemas.ts";
import type { UserProjectionEntry } from "../schemas.ts";
import { planUserContractApproval } from "../approval/plan.ts";
import { analyzeContractEnvelopeBoundary } from "../boundary_analysis.ts";
import { evaluateEnvelopeFit } from "../envelope_decision.ts";

const EMPTY_BOUNDARY: EnvelopeBoundary = {
  contracts: [],
  surfaces: [],
  capabilities: [],
  resources: [],
};

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
  contracts: Pick<
    ContractsModule,
    | "getActiveEntries"
    | "getKnownEntriesByContractId"
    | "getKnownContract"
    | "validateContract"
  >;
  loadUserProjection: (
    userId: string,
  ) => Promise<UserProjectionEntry | null>;
  capabilityGroupStorage?: CapabilityGroupLoader;
}): Promise<ResolveUserReconnectResult> {
  const knownContract = await args.contracts.getKnownContract(
    args.presentedContractDigest,
  );
  const expectedContractId = args.session.app?.contractId ??
    args.session.contractId;
  if (!knownContract || knownContract.id !== expectedContractId) {
    return { ok: false, reason: "contract_changed" };
  }

  const projection = await args.loadUserProjection(args.session.userId);
  if (!projection) {
    return { ok: false, reason: "user_not_found" };
  }
  if (!projection.active) {
    return { ok: false, reason: "user_inactive" };
  }

  const plan = await planUserContractApproval(
    args.contracts,
    knownContract,
  );
  if (
    plan.digest !== args.presentedContractDigest ||
    plan.contract.id !== expectedContractId
  ) {
    return { ok: false, reason: "contract_changed" };
  }

  const requestedBoundary = (await analyzeContractEnvelopeBoundary(
    args.contracts,
    knownContract,
    { dependencyResolution: "known" },
  )).required;
  const existingEnvelope = args.session.identityEnvelope ?? EMPTY_BOUNDARY;
  const envelopeFit = evaluateEnvelopeFit(existingEnvelope, requestedBoundary);

  if (!envelopeFit.fits) {
    return { ok: false, reason: "approval_required" };
  }
  const resolvedCapabilities = await resolveCapabilities(
    projection,
    args.capabilityGroupStorage,
  );
  if (
    !approvalCapabilityKeys(plan.approval).every((capability) =>
      resolvedCapabilities.includes(capability)
    )
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
      approvalSource: args.session.approvalSource ?? "stored_approval",
      identityEnvelope: requestedBoundary,
      delegatedCapabilities: approvalCapabilityKeys(plan.approval),
      delegatedPublishSubjects: plan.publishSubjects,
      delegatedSubscribeSubjects: plan.subscribeSubjects,
    },
  };
}
