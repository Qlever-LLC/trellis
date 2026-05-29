import { approvalCapabilityKeys } from "@qlever-llc/trellis/auth";

import type { ContractsModule } from "../../catalog/runtime.ts";
import type { CapabilityGroupLoader } from "../capability_groups.ts";
import { resolveCapabilities } from "../capability_groups.ts";
import type {
  AuthorityNeedSet,
  AuthorityNeedSetResource,
  AuthorityNeedSetSurface,
  UserSession,
} from "../schemas.ts";
import type { UserProjectionEntry } from "../schemas.ts";
import { planUserContractApproval } from "../approval/plan.ts";
import { analyzeContractProposal } from "../contract_proposal_analysis.ts";
import { evaluateProposalNeedsFit } from "../authority_needs_decision.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBoundaryContract(
  value: unknown,
): value is AuthorityNeedSet["contracts"][number] {
  return isRecord(value) && typeof value.contractId === "string" &&
    typeof value.required === "boolean";
}

function isBoundarySurface(value: unknown): value is AuthorityNeedSetSurface {
  return isRecord(value) && typeof value.contractId === "string" &&
    typeof value.kind === "string" && typeof value.name === "string" &&
    (value.action === undefined || typeof value.action === "string") &&
    typeof value.required === "boolean";
}

function isBoundaryResource(value: unknown): value is AuthorityNeedSetResource {
  return isRecord(value) && typeof value.kind === "string" &&
    typeof value.alias === "string" && typeof value.required === "boolean";
}

function coerceAuthorityNeedSet(value: unknown): AuthorityNeedSet {
  if (!isRecord(value)) return EMPTY_AUTHORITY_NEEDS;
  const { contracts, surfaces, capabilities, resources } = value;
  if (
    !Array.isArray(contracts) || !Array.isArray(surfaces) ||
    !Array.isArray(capabilities) || !Array.isArray(resources)
  ) {
    return EMPTY_AUTHORITY_NEEDS;
  }
  if (
    !contracts.every(isBoundaryContract) ||
    !surfaces.every(isBoundarySurface) ||
    !capabilities.every((capability) => typeof capability === "string") ||
    !resources.every(isBoundaryResource)
  ) {
    return EMPTY_AUTHORITY_NEEDS;
  }
  return { contracts, surfaces, capabilities, resources };
}

const EMPTY_AUTHORITY_NEEDS: AuthorityNeedSet = {
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

  const requestedNeeds = (await analyzeContractProposal(
    args.contracts,
    knownContract,
    { dependencyResolution: "known" },
  )).required;
  const existingAuthority = coerceAuthorityNeedSet(
    args.session.identityAuthorityNeeds,
  );
  const authorityFit = evaluateProposalNeedsFit(
    existingAuthority,
    requestedNeeds,
  );

  if (!authorityFit.fits) {
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
      identityAuthorityNeeds: requestedNeeds,
      delegatedCapabilities: approvalCapabilityKeys(plan.approval),
      delegatedPublishSubjects: plan.publishSubjects,
      delegatedSubscribeSubjects: plan.subscribeSubjects,
    },
  };
}
