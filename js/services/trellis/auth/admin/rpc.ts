import { AuthError } from "@qlever-llc/trellis";
import { isErr, Result } from "@qlever-llc/result";

import {
  deviceActivationHandoffsKV,
  deviceActivationReviewsKV,
  deviceActivationsKV,
  deviceInstancesKV,
  devicePortalSelectionsKV,
  deviceProvisioningSecretsKV,
  deviceProfilesKV,
  logger,
  loginPortalSelectionsKV,
  portalDefaultsKV,
  portalsKV,
} from "../../bootstrap/globals.ts";
import {
  type CreatePortalRequest,
  type CreateDeviceProfileRequest,
  type DeviceActivationReview,
  type DeviceInstance,
  type DevicePortalSelection,
  type DevicePortalSelectionRequest,
  type DeviceProvisioningSecret,
  type DeviceProfile,
  type ProvisionDeviceInstanceRequest,
  type LoginPortalSelection,
  type LoginPortalSelectionRequest,
  type Portal,
  type PortalDefault,
  type PortalDefaultRequest,
  validateLoginPortalSelectionRequest,
  validateDevicePortalSelectionRequest,
  validateDeviceProfileRequest,
  validateDeviceProvisionRequest,
  validatePortalDefaultRequest,
  validatePortalRequest,
} from "./shared.ts";
import { deriveDeviceConfirmationCode } from "../../../../packages/auth/device_activation.ts";

type RpcUser = { capabilities?: string[] };
type DeviceActivation = {
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

type DeviceActivationHandoff = {
  handoffId: string;
  instanceId: string;
  publicIdentityKey: string;
  nonce: string;
  qrMac: string;
  createdAt: Date | string;
  expiresAt: Date | string;
};

type DeviceActivationReviewRecord = {
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
const DEVICE_DEFAULT_KEY = "device.default";

function isAdmin(user: RpcUser): boolean {
  return user.capabilities?.includes("admin") ?? false;
}

function canReview(user: RpcUser): boolean {
  return isAdmin(user) || (user.capabilities?.includes("device.review") ?? false);
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

function deviceSelectionKey(profileId: string): string {
  return `profile.${profileId}`;
}

async function loadPortal(portalId: string): Promise<Portal | null> {
  const entry = (await portalsKV.get(portalId)).take();
  if (isErr(entry)) return null;
  return entry.value as Portal;
}

async function loadDeviceProfile(profileId: string): Promise<DeviceProfile | null> {
  const entry = (await deviceProfilesKV.get(profileId)).take();
  if (isErr(entry)) return null;
  return entry.value as DeviceProfile;
}

async function loadDeviceInstance(instanceId: string): Promise<DeviceInstance | null> {
  const entry = (await deviceInstancesKV.get(instanceId)).take();
  if (isErr(entry)) return null;
  return entry.value as DeviceInstance;
}

async function loadDeviceProvisioningSecret(instanceId: string): Promise<DeviceProvisioningSecret | null> {
  const entry = (await deviceProvisioningSecretsKV.get(instanceId)).take();
  if (isErr(entry)) return null;
  return entry.value as DeviceProvisioningSecret;
}

async function loadDeviceActivationReview(reviewId: string): Promise<DeviceActivationReviewRecord | null> {
  const entry = (await deviceActivationReviewsKV.get(reviewId)).take();
  if (isErr(entry)) return null;
  return entry.value as DeviceActivationReviewRecord;
}

async function loadDeviceActivationHandoff(handoffId: string): Promise<DeviceActivationHandoff | null> {
  const entry = (await deviceActivationHandoffsKV.get(handoffId)).take();
  if (isErr(entry)) return null;
  return entry.value as DeviceActivationHandoff;
}

async function loadDeviceActivation(instanceId: string): Promise<DeviceActivation | null> {
  const entry = (await deviceActivationsKV.get(instanceId)).take();
  if (isErr(entry)) return null;
  return entry.value as DeviceActivation;
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

async function loadDevicePortalSelection(profileId: string): Promise<DevicePortalSelection | null> {
  const entry = (await devicePortalSelectionsKV.get(deviceSelectionKey(profileId))).take();
  if (isErr(entry)) return null;
  return entry.value as DevicePortalSelection;
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

async function listDevicePortalSelections(): Promise<DevicePortalSelection[]> {
  const iter = (await devicePortalSelectionsKV.keys(">"))?.take();
  if (isErr(iter)) return [];
  const values: DevicePortalSelection[] = [];
  for await (const key of iter) {
    const entry = (await devicePortalSelectionsKV.get(key)).take();
    if (!isErr(entry)) values.push(entry.value as DevicePortalSelection);
  }
  values.sort((left, right) => left.profileId.localeCompare(right.profileId));
  return values;
}

async function listDeviceProfiles(): Promise<DeviceProfile[]> {
  const iter = (await deviceProfilesKV.keys(">"))?.take();
  if (isErr(iter)) return [];
  const values: DeviceProfile[] = [];
  for await (const key of iter) {
    const entry = (await deviceProfilesKV.get(key)).take();
    if (!isErr(entry)) values.push(entry.value as DeviceProfile);
  }
  values.sort((left, right) => left.profileId.localeCompare(right.profileId));
  return values;
}

async function listDeviceInstances(): Promise<DeviceInstance[]> {
  const iter = (await deviceInstancesKV.keys(">"))?.take();
  if (isErr(iter)) return [];
  const values: DeviceInstance[] = [];
  for await (const key of iter) {
    const entry = (await deviceInstancesKV.get(key)).take();
    if (!isErr(entry)) values.push(entry.value as DeviceInstance);
  }
  values.sort((left, right) => left.instanceId.localeCompare(right.instanceId));
  return values;
}

async function listDeviceActivations(): Promise<DeviceActivation[]> {
  const iter = (await deviceActivationsKV.keys(">"))?.take();
  if (isErr(iter)) return [];
  const values: DeviceActivation[] = [];
  for await (const key of iter) {
    const entry = (await deviceActivationsKV.get(key)).take();
    if (!isErr(entry)) values.push(entry.value as DeviceActivation);
  }
  values.sort((left, right) => left.instanceId.localeCompare(right.instanceId));
  return values;
}

async function listDeviceActivationReviews(): Promise<DeviceActivationReviewRecord[]> {
  const iter = (await deviceActivationReviewsKV.keys(">"))?.take();
  if (isErr(iter)) return [];
  const values: DeviceActivationReviewRecord[] = [];
  for await (const key of iter) {
    const entry = (await deviceActivationReviewsKV.get(key)).take();
    if (!isErr(entry)) values.push(entry.value as DeviceActivationReviewRecord);
  }
  values.sort((left, right) => left.reviewId.localeCompare(right.reviewId));
  return values;
}

function toPublicReview(review: DeviceActivationReviewRecord): DeviceActivationReview {
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

async function confirmationCodeForReview(review: DeviceActivationReviewRecord): Promise<string | null> {
  const handoff = await loadDeviceActivationHandoff(review.handoffId);
  const provisioningSecret = await loadDeviceProvisioningSecret(review.instanceId);
  if (!handoff || !provisioningSecret) return null;
  return await deriveDeviceConfirmationCode({
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

export const authGetDevicePortalDefaultHandler = async (_req: unknown, { caller }: { caller: RpcUser }) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({ defaultPortal: (await loadPortalDefault(DEVICE_DEFAULT_KEY)) ?? { portalId: null } });
};

export const authSetDevicePortalDefaultHandler = async (
  req: PortalDefaultRequest,
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const validation = validatePortalDefaultRequest(req);
  if (validation.isErr()) return validation;
  const { defaultPortal } = validation.take() as { defaultPortal: PortalDefault };
  const referenceCheck = await ensurePortalReference(defaultPortal.portalId);
  if (referenceCheck.isErr()) return referenceCheck;
  await portalDefaultsKV.put(DEVICE_DEFAULT_KEY, defaultPortal);
  return Result.ok({ defaultPortal });
};

export const authListDevicePortalSelectionsHandler = async (_req: unknown, { caller }: { caller: RpcUser }) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({ selections: await listDevicePortalSelections() });
};

export const authSetDevicePortalSelectionHandler = async (
  req: DevicePortalSelectionRequest,
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const validation = validateDevicePortalSelectionRequest(req);
  if (validation.isErr()) return validation;
  const { selection } = validation.take() as { selection: DevicePortalSelection };
  const profile = await loadDeviceProfile(selection.profileId);
  if (!profile || profile.disabled) {
    return invalidRequest({ profileId: selection.profileId, reason: "device_profile_not_found" });
  }
  const referenceCheck = await ensurePortalReference(selection.portalId);
  if (referenceCheck.isErr()) return referenceCheck;
  await devicePortalSelectionsKV.put(deviceSelectionKey(selection.profileId), selection);
  return Result.ok({ selection });
};

export const authClearDevicePortalSelectionHandler = async (
  req: { profileId: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const selection = await loadDevicePortalSelection(req.profileId);
  if (!selection) return Result.ok({ success: false });
  await devicePortalSelectionsKV.delete(deviceSelectionKey(req.profileId));
  return Result.ok({ success: true });
};

export function createAuthCreateDeviceProfileHandler(deps: {
  installDeviceContract: (contract: unknown) => Promise<{ id: string; digest: string }>;
  refreshActiveContracts: () => Promise<void>;
}) {
  return async (req: Parameters<typeof validateDeviceProfileRequest>[0], { caller }: { caller: RpcUser }) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const validation = validateDeviceProfileRequest(req);
    if (validation.isErr()) return validation;
    const { profile } = validation.take() as { profile: DeviceProfile };
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
        installed = await deps.installDeviceContract(contract);
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
              message: "device contract id mismatch",
            },
          }),
        );
      }

      await deps.refreshActiveContracts();
    }
    await deviceProfilesKV.put(profile.profileId, profile);
    return Result.ok({ profile });
  };
}

export const authListDeviceProfilesHandler = async (
  req: { contractId?: string; disabled?: boolean },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  let profiles = await listDeviceProfiles();
  if (req.contractId) profiles = profiles.filter((profile) => profile.contractId === req.contractId);
  if (req.disabled !== undefined) profiles = profiles.filter((profile) => profile.disabled === req.disabled);
  return Result.ok({ profiles });
};

export const authDisableDeviceProfileHandler = async (
  req: { profileId: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const profile = await loadDeviceProfile(req.profileId);
  if (!profile) return Result.ok({ success: false });
  await deviceProfilesKV.put(req.profileId, { ...profile, disabled: true });
  return Result.ok({ success: true });
};

export function createAuthProvisionDeviceInstanceHandler() {
  return async (req: ProvisionDeviceInstanceRequest, { caller }: { caller: RpcUser }) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const validation = validateDeviceProvisionRequest(req);
    if (validation.isErr()) return validation;
    const { instance, provisioningSecret } = validation.take() as {
      instance: DeviceInstance;
      provisioningSecret: DeviceProvisioningSecret;
    };
    const profile = await loadDeviceProfile(instance.profileId);
    if (!profile || profile.disabled) {
      return invalidRequest({ profileId: instance.profileId, reason: "device_profile_not_found" });
    }
    await deviceInstancesKV.put(instance.instanceId, instance);
    await deviceProvisioningSecretsKV.put(instance.instanceId, provisioningSecret);
    return Result.ok({ instance });
  };
}

export const authListDeviceInstancesHandler = async (
  req: { profileId?: string; state?: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  let instances = await listDeviceInstances();
  if (req.profileId) instances = instances.filter((instance) => instance.profileId === req.profileId);
  if (req.state) instances = instances.filter((instance) => instance.state === req.state);
  return Result.ok({ instances });
};

export const authDisableDeviceInstanceHandler = async (
  req: { instanceId: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const instance = await loadDeviceInstance(req.instanceId);
  if (!instance) return Result.ok({ success: false });
  await deviceInstancesKV.put(req.instanceId, { ...instance, state: "disabled" });
  return Result.ok({ success: true });
};

export const authListDeviceActivationsHandler = async (
  req: { instanceId?: string; profileId?: string; state?: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  let activations = await listDeviceActivations();
  if (req.instanceId) activations = activations.filter((activation) => activation.instanceId === req.instanceId);
  if (req.profileId) activations = activations.filter((activation) => activation.profileId === req.profileId);
  if (req.state) activations = activations.filter((activation) => activation.state === req.state);
  return Result.ok({ activations });
};

export const authRevokeDeviceActivationHandler = async (
  req: { instanceId: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const activation = (await deviceActivationsKV.get(req.instanceId)).take();
  if (isErr(activation)) return Result.ok({ success: false });
  await deviceActivationsKV.put(req.instanceId, {
    ...(activation.value as DeviceActivation),
    state: "revoked",
    revokedAt: new Date().toISOString(),
  });
  return Result.ok({ success: true });
};

export const authListDeviceActivationReviewsHandler = async (
  req: { instanceId?: string; profileId?: string; state?: string },
  { caller }: { caller: RpcUser },
) => {
  if (!canReview(caller)) return insufficientPermissions();
  let reviews = await listDeviceActivationReviews();
  if (req.instanceId) reviews = reviews.filter((review) => review.instanceId === req.instanceId);
  if (req.profileId) reviews = reviews.filter((review) => review.profileId === req.profileId);
  if (req.state) reviews = reviews.filter((review) => review.state === req.state);
  return Result.ok({ reviews: reviews.map(toPublicReview) });
};

export const authDecideDeviceActivationReviewHandler = async (
  req: { reviewId: string; decision: "approve" | "reject"; reason?: string },
  { caller }: { caller: RpcUser },
) => {
  if (!canReview(caller)) return insufficientPermissions();
  const review = await loadDeviceActivationReview(req.reviewId);
  if (!review) {
    return invalidRequest({ reviewId: req.reviewId, reason: "device_review_not_found" });
  }

  if (review.state !== "pending") {
    const activation = review.state === "approved" ? await loadDeviceActivation(review.instanceId) : null;
    const confirmationCode = review.state === "approved" ? await confirmationCodeForReview(review) : null;
    return Result.ok({
      review: toPublicReview(review),
      ...(activation ? { activation } : {}),
      ...(confirmationCode ? { confirmationCode } : {}),
    });
  }

  const decidedAt = new Date().toISOString();
  const nextState = req.decision === "approve" ? "approved" : "rejected";
  const updatedReview: DeviceActivationReviewRecord = {
    ...review,
    state: nextState,
    decidedAt,
    ...(req.reason ? { reason: req.reason } : {}),
  };
  await deviceActivationReviewsKV.put(updatedReview.reviewId, updatedReview);

  if (req.decision === "reject") {
    return Result.ok({ review: toPublicReview(updatedReview) });
  }

  const instance = await loadDeviceInstance(review.instanceId);
  const profile = await loadDeviceProfile(review.profileId);
  if (!instance || instance.state === "disabled") {
    return invalidRequest({ instanceId: review.instanceId, reason: "unknown_device" });
  }
  if (!profile || profile.disabled) {
    return invalidRequest({ profileId: review.profileId, reason: "device_profile_not_found" });
  }

  const activatedAt = new Date().toISOString();
  const activation: DeviceActivation = {
    instanceId: instance.instanceId,
    publicIdentityKey: instance.publicIdentityKey,
    profileId: profile.profileId,
    activatedBy: review.requestedBy,
    state: "activated",
    activatedAt,
    revokedAt: null,
  };
  await deviceActivationsKV.put(activation.instanceId, activation);
  await deviceInstancesKV.put(instance.instanceId, {
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
