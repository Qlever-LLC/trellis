import { AuthError } from "@qlever-llc/trellis";
import { isErr, Result } from "@qlever-llc/result";

import {
  logger,
  loginPortalSelectionsKV,
  portalDefaultsKV,
  portalsKV,
  workloadActivationHandoffsKV,
  workloadActivationReviewsKV,
  workloadActivationsKV,
  workloadInstancesKV,
  workloadPortalSelectionsKV,
  workloadProvisioningSecretsKV,
  workloadProfilesKV,
} from "../../bootstrap/globals.ts";
import {
  type CreatePortalRequest,
  type LoginPortalSelection,
  type LoginPortalSelectionRequest,
  type Portal,
  type PortalDefault,
  type PortalDefaultRequest,
  type ProvisionWorkloadInstanceRequest,
  type WorkloadActivationReview,
  type WorkloadInstance,
  type WorkloadPortalSelection,
  type WorkloadPortalSelectionRequest,
  type WorkloadProvisioningSecret,
  type WorkloadProfile,
  validateLoginPortalSelectionRequest,
  validatePortalDefaultRequest,
  validatePortalRequest,
  validateWorkloadProvisionRequest,
  validateWorkloadPortalSelectionRequest,
  validateWorkloadProfileRequest,
} from "./shared.ts";
import { deriveWorkloadConfirmationCode } from "../../../../packages/auth/workload_activation.ts";

type RpcUser = { capabilities?: string[] };
type WorkloadActivation = {
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  activatedBy?: {
    origin: string;
    id: string;
  };
  state: "activated" | "revoked";
  activatedAt: string;
  revokedAt: string | null;
};

type WorkloadActivationHandoff = {
  handoffId: string;
  instanceId: string;
  publicIdentityKey: string;
  nonce: string;
  qrMac: string;
  createdAt: Date | string;
  expiresAt: Date | string;
};

type WorkloadActivationReviewRecord = {
  reviewId: string;
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  state: "pending" | "approved" | "rejected";
  requestedAt: string | Date;
  decidedAt: string | Date | null;
  reason?: string;
  handoffId: string;
  requestedBy: {
    origin: string;
    id: string;
  };
};

const LOGIN_DEFAULT_KEY = "login.default";
const WORKLOAD_DEFAULT_KEY = "workload.default";

function isAdmin(user: RpcUser): boolean {
  return user.capabilities?.includes("admin") ?? false;
}

function canReview(user: RpcUser): boolean {
  return isAdmin(user) || (user.capabilities?.includes("workload.review") ?? false);
}

function insufficientPermissions() {
  return Result.err(new AuthError({ reason: "insufficient_permissions" }));
}

function invalidRequest(context?: Record<string, unknown>) {
  return Result.err(new AuthError({ reason: "invalid_request", context }));
}

function loginSelectionKey(contractId: string): string {
  return `contract.${contractId}`;
}

function workloadSelectionKey(profileId: string): string {
  return `profile.${profileId}`;
}

async function loadPortal(portalId: string): Promise<Portal | null> {
  const entry = (await portalsKV.get(portalId)).take();
  if (isErr(entry)) return null;
  return entry.value as Portal;
}

async function loadWorkloadProfile(profileId: string): Promise<WorkloadProfile | null> {
  const entry = (await workloadProfilesKV.get(profileId)).take();
  if (isErr(entry)) return null;
  return entry.value as WorkloadProfile;
}

async function loadWorkloadInstance(instanceId: string): Promise<WorkloadInstance | null> {
  const entry = (await workloadInstancesKV.get(instanceId)).take();
  if (isErr(entry)) return null;
  return entry.value as WorkloadInstance;
}

async function loadWorkloadProvisioningSecret(instanceId: string): Promise<WorkloadProvisioningSecret | null> {
  const entry = (await workloadProvisioningSecretsKV.get(instanceId)).take();
  if (isErr(entry)) return null;
  return entry.value as WorkloadProvisioningSecret;
}

async function loadWorkloadActivationReview(reviewId: string): Promise<WorkloadActivationReviewRecord | null> {
  const entry = (await workloadActivationReviewsKV.get(reviewId)).take();
  if (isErr(entry)) return null;
  return entry.value as WorkloadActivationReviewRecord;
}

async function loadWorkloadActivationHandoff(handoffId: string): Promise<WorkloadActivationHandoff | null> {
  const entry = (await workloadActivationHandoffsKV.get(handoffId)).take();
  if (isErr(entry)) return null;
  return entry.value as WorkloadActivationHandoff;
}

async function loadWorkloadActivation(instanceId: string): Promise<WorkloadActivation | null> {
  const entry = (await workloadActivationsKV.get(instanceId)).take();
  if (isErr(entry)) return null;
  return entry.value as WorkloadActivation;
}

async function loadPortalDefault(key: string): Promise<PortalDefault | null> {
  const entry = (await portalDefaultsKV.get(key)).take();
  if (isErr(entry)) return null;
  return entry.value as PortalDefault;
}

async function loadLoginPortalSelection(contractId: string): Promise<LoginPortalSelection | null> {
  const entry = (await loginPortalSelectionsKV.get(loginSelectionKey(contractId))).take();
  if (isErr(entry)) return null;
  return entry.value as LoginPortalSelection;
}

async function loadWorkloadPortalSelection(profileId: string): Promise<WorkloadPortalSelection | null> {
  const entry = (await workloadPortalSelectionsKV.get(workloadSelectionKey(profileId))).take();
  if (isErr(entry)) return null;
  return entry.value as WorkloadPortalSelection;
}

async function listPortals(): Promise<Portal[]> {
  const iter = (await portalsKV.keys(">"))?.take();
  if (isErr(iter)) return [];
  const values: Portal[] = [];
  for await (const key of iter) {
    const entry = (await portalsKV.get(key)).take();
    if (!isErr(entry)) values.push(entry.value as Portal);
  }
  values.sort((left, right) => left.portalId.localeCompare(right.portalId));
  return values;
}

async function listLoginPortalSelections(): Promise<LoginPortalSelection[]> {
  const iter = (await loginPortalSelectionsKV.keys(">"))?.take();
  if (isErr(iter)) return [];
  const values: LoginPortalSelection[] = [];
  for await (const key of iter) {
    const entry = (await loginPortalSelectionsKV.get(key)).take();
    if (!isErr(entry)) values.push(entry.value as LoginPortalSelection);
  }
  values.sort((left, right) => left.contractId.localeCompare(right.contractId));
  return values;
}

async function listWorkloadPortalSelections(): Promise<WorkloadPortalSelection[]> {
  const iter = (await workloadPortalSelectionsKV.keys(">"))?.take();
  if (isErr(iter)) return [];
  const values: WorkloadPortalSelection[] = [];
  for await (const key of iter) {
    const entry = (await workloadPortalSelectionsKV.get(key)).take();
    if (!isErr(entry)) values.push(entry.value as WorkloadPortalSelection);
  }
  values.sort((left, right) => left.profileId.localeCompare(right.profileId));
  return values;
}

async function listWorkloadProfiles(): Promise<WorkloadProfile[]> {
  const iter = (await workloadProfilesKV.keys(">"))?.take();
  if (isErr(iter)) return [];
  const values: WorkloadProfile[] = [];
  for await (const key of iter) {
    const entry = (await workloadProfilesKV.get(key)).take();
    if (!isErr(entry)) values.push(entry.value as WorkloadProfile);
  }
  values.sort((left, right) => left.profileId.localeCompare(right.profileId));
  return values;
}

async function listWorkloadInstances(): Promise<WorkloadInstance[]> {
  const iter = (await workloadInstancesKV.keys(">"))?.take();
  if (isErr(iter)) return [];
  const values: WorkloadInstance[] = [];
  for await (const key of iter) {
    const entry = (await workloadInstancesKV.get(key)).take();
    if (!isErr(entry)) values.push(entry.value as WorkloadInstance);
  }
  values.sort((left, right) => left.instanceId.localeCompare(right.instanceId));
  return values;
}

async function listWorkloadActivations(): Promise<WorkloadActivation[]> {
  const iter = (await workloadActivationsKV.keys(">"))?.take();
  if (isErr(iter)) return [];
  const values: WorkloadActivation[] = [];
  for await (const key of iter) {
    const entry = (await workloadActivationsKV.get(key)).take();
    if (!isErr(entry)) values.push(entry.value as WorkloadActivation);
  }
  values.sort((left, right) => left.instanceId.localeCompare(right.instanceId));
  return values;
}

async function listWorkloadActivationReviews(): Promise<WorkloadActivationReviewRecord[]> {
  const iter = (await workloadActivationReviewsKV.keys(">"))?.take();
  if (isErr(iter)) return [];
  const values: WorkloadActivationReviewRecord[] = [];
  for await (const key of iter) {
    const entry = (await workloadActivationReviewsKV.get(key)).take();
    if (!isErr(entry)) values.push(entry.value as WorkloadActivationReviewRecord);
  }
  values.sort((left, right) => left.reviewId.localeCompare(right.reviewId));
  return values;
}

function toPublicReview(review: WorkloadActivationReviewRecord): WorkloadActivationReview {
  return {
    reviewId: review.reviewId,
    instanceId: review.instanceId,
    publicIdentityKey: review.publicIdentityKey,
    profileId: review.profileId,
    state: review.state,
    requestedAt: review.requestedAt instanceof Date ? review.requestedAt.toISOString() : review.requestedAt,
    decidedAt: review.decidedAt instanceof Date ? review.decidedAt.toISOString() : review.decidedAt,
    ...(review.reason ? { reason: review.reason } : {}),
  };
}

async function confirmationCodeForReview(review: WorkloadActivationReviewRecord): Promise<string | null> {
  const handoff = await loadWorkloadActivationHandoff(review.handoffId);
  const provisioningSecret = await loadWorkloadProvisioningSecret(review.instanceId);
  if (!handoff || !provisioningSecret) return null;
  return await deriveWorkloadConfirmationCode({
    activationKey: provisioningSecret.activationKey,
    publicIdentityKey: review.publicIdentityKey,
    nonce: handoff.nonce,
  });
}

async function ensurePortalReference(portalId: string | null) {
  if (portalId === null) return Result.ok(undefined);
  const portal = await loadPortal(portalId);
  if (!portal || portal.disabled) {
    return invalidRequest({ portalId, reason: "portal_not_found" });
  }
  return Result.ok(undefined);
}

export function createAuthCreatePortalHandler() {
  return async (req: CreatePortalRequest, { caller }: { caller: RpcUser }) => {
    logger.trace({ rpc: "Auth.CreatePortal", portalId: req.portalId }, "RPC request");
    if (!isAdmin(caller)) return insufficientPermissions();
    const validation = validatePortalRequest(req);
    if (validation.isErr()) return validation;
    const { portal } = validation.take() as { portal: Portal };
    await portalsKV.put(portal.portalId, portal);
    return Result.ok({ portal });
  };
}

export const authListPortalsHandler = async (_req: unknown, { caller }: { caller: RpcUser }) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({ portals: await listPortals() });
};

export const authDisablePortalHandler = async (
  req: { portalId: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const portal = await loadPortal(req.portalId);
  if (!portal) return Result.ok({ success: false });
  await portalsKV.put(req.portalId, { ...portal, disabled: true });
  return Result.ok({ success: true });
};

export const authGetLoginPortalDefaultHandler = async (_req: unknown, { caller }: { caller: RpcUser }) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({ defaultPortal: (await loadPortalDefault(LOGIN_DEFAULT_KEY)) ?? { portalId: null } });
};

export const authSetLoginPortalDefaultHandler = async (
  req: PortalDefaultRequest,
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const validation = validatePortalDefaultRequest(req);
  if (validation.isErr()) return validation;
  const { defaultPortal } = validation.take() as { defaultPortal: PortalDefault };
  const referenceCheck = await ensurePortalReference(defaultPortal.portalId);
  if (referenceCheck.isErr()) return referenceCheck;
  await portalDefaultsKV.put(LOGIN_DEFAULT_KEY, defaultPortal);
  return Result.ok({ defaultPortal });
};

export const authListLoginPortalSelectionsHandler = async (_req: unknown, { caller }: { caller: RpcUser }) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({ selections: await listLoginPortalSelections() });
};

export const authSetLoginPortalSelectionHandler = async (
  req: LoginPortalSelectionRequest,
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const validation = validateLoginPortalSelectionRequest(req);
  if (validation.isErr()) return validation;
  const { selection } = validation.take() as { selection: LoginPortalSelection };
  const referenceCheck = await ensurePortalReference(selection.portalId);
  if (referenceCheck.isErr()) return referenceCheck;
  await loginPortalSelectionsKV.put(loginSelectionKey(selection.contractId), selection);
  return Result.ok({ selection });
};

export const authClearLoginPortalSelectionHandler = async (
  req: { contractId: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const selection = await loadLoginPortalSelection(req.contractId);
  if (!selection) return Result.ok({ success: false });
  await loginPortalSelectionsKV.delete(loginSelectionKey(req.contractId));
  return Result.ok({ success: true });
};

export const authGetWorkloadPortalDefaultHandler = async (_req: unknown, { caller }: { caller: RpcUser }) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({ defaultPortal: (await loadPortalDefault(WORKLOAD_DEFAULT_KEY)) ?? { portalId: null } });
};

export const authSetWorkloadPortalDefaultHandler = async (
  req: PortalDefaultRequest,
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const validation = validatePortalDefaultRequest(req);
  if (validation.isErr()) return validation;
  const { defaultPortal } = validation.take() as { defaultPortal: PortalDefault };
  const referenceCheck = await ensurePortalReference(defaultPortal.portalId);
  if (referenceCheck.isErr()) return referenceCheck;
  await portalDefaultsKV.put(WORKLOAD_DEFAULT_KEY, defaultPortal);
  return Result.ok({ defaultPortal });
};

export const authListWorkloadPortalSelectionsHandler = async (_req: unknown, { caller }: { caller: RpcUser }) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({ selections: await listWorkloadPortalSelections() });
};

export const authSetWorkloadPortalSelectionHandler = async (
  req: WorkloadPortalSelectionRequest,
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const validation = validateWorkloadPortalSelectionRequest(req);
  if (validation.isErr()) return validation;
  const { selection } = validation.take() as { selection: WorkloadPortalSelection };
  const profile = await loadWorkloadProfile(selection.profileId);
  if (!profile || profile.disabled) {
    return invalidRequest({ profileId: selection.profileId, reason: "workload_profile_not_found" });
  }
  const referenceCheck = await ensurePortalReference(selection.portalId);
  if (referenceCheck.isErr()) return referenceCheck;
  await workloadPortalSelectionsKV.put(workloadSelectionKey(selection.profileId), selection);
  return Result.ok({ selection });
};

export const authClearWorkloadPortalSelectionHandler = async (
  req: { profileId: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const selection = await loadWorkloadPortalSelection(req.profileId);
  if (!selection) return Result.ok({ success: false });
  await workloadPortalSelectionsKV.delete(workloadSelectionKey(req.profileId));
  return Result.ok({ success: true });
};

export function createAuthCreateWorkloadProfileHandler(deps: {
  installWorkloadContract: (contract: unknown) => Promise<{ id: string; digest: string }>;
  refreshActiveContracts: () => Promise<void>;
}) {
  return async (req: Parameters<typeof validateWorkloadProfileRequest>[0], { caller }: { caller: RpcUser }) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const validation = validateWorkloadProfileRequest(req);
    if (validation.isErr()) return validation;
    const { profile } = validation.take() as { profile: WorkloadProfile };
    if (req.contract) {
      if (Array.isArray(req.contract)) {
        return Result.err(
          new AuthError({
            reason: "invalid_request",
            context: {
              profileId: profile.profileId,
              contractId: profile.contractId,
              message: "contract must be an object",
            },
          }),
        );
      }
      const contract = Object.fromEntries(Object.entries(req.contract));
      let installed;
      try {
        installed = await deps.installWorkloadContract(contract);
      } catch (error) {
        return Result.err(
          new AuthError({
            reason: "invalid_request",
            context: {
              profileId: profile.profileId,
              contractId: profile.contractId,
              message: error instanceof Error ? error.message : String(error),
            },
          }),
        );
      }

      if (installed.id !== profile.contractId) {
        return Result.err(
          new AuthError({
            reason: "invalid_request",
            context: {
              profileId: profile.profileId,
              contractId: profile.contractId,
              installedContractId: installed.id,
              message: "workload contract id mismatch",
            },
          }),
        );
      }

      await deps.refreshActiveContracts();
    }
    await workloadProfilesKV.put(profile.profileId, profile);
    return Result.ok({ profile });
  };
}

export const authListWorkloadProfilesHandler = async (
  req: { contractId?: string; disabled?: boolean },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  let profiles = await listWorkloadProfiles();
  if (req.contractId) profiles = profiles.filter((profile) => profile.contractId === req.contractId);
  if (req.disabled !== undefined) profiles = profiles.filter((profile) => profile.disabled === req.disabled);
  return Result.ok({ profiles });
};

export const authDisableWorkloadProfileHandler = async (
  req: { profileId: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const profile = await loadWorkloadProfile(req.profileId);
  if (!profile) return Result.ok({ success: false });
  await workloadProfilesKV.put(req.profileId, { ...profile, disabled: true });
  return Result.ok({ success: true });
};

export function createAuthProvisionWorkloadInstanceHandler() {
  return async (req: ProvisionWorkloadInstanceRequest, { caller }: { caller: RpcUser }) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const validation = validateWorkloadProvisionRequest(req);
    if (validation.isErr()) return validation;
    const { instance, provisioningSecret } = validation.take() as {
      instance: WorkloadInstance;
      provisioningSecret: WorkloadProvisioningSecret;
    };
    const profile = await loadWorkloadProfile(instance.profileId);
    if (!profile || profile.disabled) {
      return invalidRequest({ profileId: instance.profileId, reason: "workload_profile_not_found" });
    }
    await workloadInstancesKV.put(instance.instanceId, instance);
    await workloadProvisioningSecretsKV.put(instance.instanceId, provisioningSecret);
    return Result.ok({ instance });
  };
}

export const authListWorkloadInstancesHandler = async (
  req: { profileId?: string; state?: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  let instances = await listWorkloadInstances();
  if (req.profileId) instances = instances.filter((instance) => instance.profileId === req.profileId);
  if (req.state) instances = instances.filter((instance) => instance.state === req.state);
  return Result.ok({ instances });
};

export const authDisableWorkloadInstanceHandler = async (
  req: { instanceId: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const instance = await loadWorkloadInstance(req.instanceId);
  if (!instance) return Result.ok({ success: false });
  await workloadInstancesKV.put(req.instanceId, { ...instance, state: "disabled" });
  return Result.ok({ success: true });
};

export const authListWorkloadActivationsHandler = async (
  req: { instanceId?: string; profileId?: string; state?: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  let activations = await listWorkloadActivations();
  if (req.instanceId) activations = activations.filter((activation) => activation.instanceId === req.instanceId);
  if (req.profileId) activations = activations.filter((activation) => activation.profileId === req.profileId);
  if (req.state) activations = activations.filter((activation) => activation.state === req.state);
  return Result.ok({ activations });
};

export const authRevokeWorkloadActivationHandler = async (
  req: { instanceId: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const activation = (await workloadActivationsKV.get(req.instanceId)).take();
  if (isErr(activation)) return Result.ok({ success: false });
  await workloadActivationsKV.put(req.instanceId, {
    ...(activation.value as WorkloadActivation),
    state: "revoked",
    revokedAt: new Date().toISOString(),
  });
  return Result.ok({ success: true });
};

export const authListWorkloadActivationReviewsHandler = async (
  req: { instanceId?: string; profileId?: string; state?: string },
  { caller }: { caller: RpcUser },
) => {
  if (!canReview(caller)) return insufficientPermissions();
  let reviews = await listWorkloadActivationReviews();
  if (req.instanceId) reviews = reviews.filter((review) => review.instanceId === req.instanceId);
  if (req.profileId) reviews = reviews.filter((review) => review.profileId === req.profileId);
  if (req.state) reviews = reviews.filter((review) => review.state === req.state);
  return Result.ok({ reviews: reviews.map(toPublicReview) });
};

export const authDecideWorkloadActivationReviewHandler = async (
  req: { reviewId: string; decision: "approve" | "reject"; reason?: string },
  { caller }: { caller: RpcUser },
) => {
  if (!canReview(caller)) return insufficientPermissions();
  const review = await loadWorkloadActivationReview(req.reviewId);
  if (!review) {
    return invalidRequest({ reviewId: req.reviewId, reason: "workload_review_not_found" });
  }

  if (review.state !== "pending") {
    const activation = review.state === "approved" ? await loadWorkloadActivation(review.instanceId) : null;
    const confirmationCode = review.state === "approved" ? await confirmationCodeForReview(review) : null;
    return Result.ok({
      review: toPublicReview(review),
      ...(activation ? { activation } : {}),
      ...(confirmationCode ? { confirmationCode } : {}),
    });
  }

  const decidedAt = new Date().toISOString();
  const nextState = req.decision === "approve" ? "approved" : "rejected";
  const updatedReview: WorkloadActivationReviewRecord = {
    ...review,
    state: nextState,
    decidedAt,
    ...(req.reason ? { reason: req.reason } : {}),
  };
  await workloadActivationReviewsKV.put(updatedReview.reviewId, updatedReview);

  if (req.decision === "reject") {
    return Result.ok({ review: toPublicReview(updatedReview) });
  }

  const instance = await loadWorkloadInstance(review.instanceId);
  const profile = await loadWorkloadProfile(review.profileId);
  if (!instance || instance.state === "disabled") {
    return invalidRequest({ instanceId: review.instanceId, reason: "unknown_workload" });
  }
  if (!profile || profile.disabled) {
    return invalidRequest({ profileId: review.profileId, reason: "workload_profile_not_found" });
  }

  const activatedAt = new Date().toISOString();
  const activation: WorkloadActivation = {
    instanceId: instance.instanceId,
    publicIdentityKey: instance.publicIdentityKey,
    profileId: profile.profileId,
    activatedBy: review.requestedBy,
    state: "activated",
    activatedAt,
    revokedAt: null,
  };
  await workloadActivationsKV.put(activation.instanceId, activation);
  await workloadInstancesKV.put(instance.instanceId, {
    ...instance,
    state: "activated",
    activatedAt,
    revokedAt: null,
  });
  const confirmationCode = await confirmationCodeForReview(updatedReview);
  return Result.ok({
    review: toPublicReview(updatedReview),
    activation,
    ...(confirmationCode ? { confirmationCode } : {}),
  });
};
