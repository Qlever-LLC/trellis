import { AuthError } from "@qlever-llc/trellis";
import { isErr, Result } from "@qlever-llc/result";

import {
  browserFlowsKV,
  connectionsKV,
  contractApprovalsKV,
  deviceActivationReviewsKV,
  deviceActivationsKV,
  deviceInstancesKV,
  devicePortalSelectionsKV,
  deviceProfilesKV,
  deviceProvisioningSecretsKV,
  instanceGrantPoliciesKV,
  logger,
  loginPortalSelectionsKV,
  portalDefaultsKV,
  portalsKV,
  sessionKV,
  trellis,
  usersKV,
} from "../../bootstrap/globals.ts";
import {
  type CreateDeviceProfileRequest,
  type CreatePortalRequest,
  type DeviceActivationReview,
  type DeviceInstance,
  type DevicePortalSelection,
  type DevicePortalSelectionRequest,
  type DeviceProfile,
  type DeviceProvisioningSecret,
  type InstanceGrantPolicy,
  type InstanceGrantPolicyActor,
  type LoginPortalSelection,
  type LoginPortalSelectionRequest,
  normalizeAppliedContracts,
  type Portal,
  type PortalDefault,
  type PortalDefaultRequest,
  type ProvisionDeviceInstanceRequest,
  type UpsertInstanceGrantPolicyRequest,
  validateDevicePortalSelectionRequest,
  validateDeviceProfileRequest,
  validateDeviceProvisionRequest,
  validateInstanceGrantPolicyRequest,
  validateLoginPortalSelectionRequest,
  validatePortalDefaultRequest,
  validatePortalRequest,
} from "./shared.ts";
import { deriveDeviceConfirmationCode } from "@qlever-llc/trellis/auth";
import { kick } from "../callout/kick.ts";
import {
  matchingInstanceGrantPolicies,
  userDelegationAllowed,
} from "../grants/policy.ts";
import type { Session, UserProjectionEntry } from "../../state/schemas.ts";

type RpcUser = { capabilities?: string[]; origin?: string; id?: string };
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

type DeviceActivationFlow = {
  flowId: string;
  instanceId: string;
  profileId: string;
  publicIdentityKey: string;
  nonce: string;
  qrMac: string;
  createdAt: Date | string;
  expiresAt: Date | string;
};

type DeviceActivationReviewRecord = {
  reviewId: string;
  linkRequestId: string;
  flowId: string;
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  state: "pending" | "approved" | "rejected";
  requestedAt: string | Date;
  decidedAt: string | Date | null;
  reason?: string;
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

function reviewableProfiles(user: RpcUser): Set<string> | null {
  if (isAdmin(user)) return null;
  const capabilities = user.capabilities ?? [];
  if (capabilities.includes("device.review")) return null;

  const profiles = new Set<string>();
  for (const capability of capabilities) {
    if (!capability.startsWith("device.review.")) continue;
    const profileId = capability.slice("device.review.".length).trim();
    if (profileId) profiles.add(profileId);
  }

  return profiles.size > 0 ? profiles : new Set<string>();
}

function canReview(user: RpcUser): boolean {
  const profiles = reviewableProfiles(user);
  return profiles === null || profiles.size > 0;
}

function canReviewProfile(user: RpcUser, profileId: string): boolean {
  if (isAdmin(user)) return true;
  const profiles = reviewableProfiles(user);
  if (profiles === null) return true;
  return profiles.has(profileId);
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

async function loadInstanceGrantPolicy(
  contractId: string,
): Promise<InstanceGrantPolicy | null> {
  const entry = (await instanceGrantPoliciesKV.get(contractId)).take();
  if (isErr(entry)) return null;
  return entry.value as InstanceGrantPolicy;
}

async function loadDeviceProfile(
  profileId: string,
): Promise<DeviceProfile | null> {
  const entry = (await deviceProfilesKV.get(profileId)).take();
  if (isErr(entry)) return null;
  return entry.value as unknown as DeviceProfile;
}

async function loadDeviceInstance(
  instanceId: string,
): Promise<DeviceInstance | null> {
  const entry = (await deviceInstancesKV.get(instanceId)).take();
  if (isErr(entry)) return null;
  return entry.value as unknown as DeviceInstance;
}

async function loadDeviceProvisioningSecret(
  instanceId: string,
): Promise<DeviceProvisioningSecret | null> {
  const entry = (await deviceProvisioningSecretsKV.get(instanceId)).take();
  if (isErr(entry)) return null;
  return entry.value as DeviceProvisioningSecret;
}

async function loadDeviceActivationReview(
  reviewId: string,
): Promise<DeviceActivationReviewRecord | null> {
  const entry = (await deviceActivationReviewsKV.get(reviewId)).take();
  if (isErr(entry)) return null;
  return entry.value as unknown as DeviceActivationReviewRecord;
}

async function loadDeviceActivationFlow(
  flowId: string,
): Promise<DeviceActivationFlow | null> {
  const entry = (await browserFlowsKV.get(flowId)).take();
  if (isErr(entry)) return null;
  const flow = entry.value as {
    flowId?: string;
    kind?: string;
    deviceActivation?: {
      instanceId: string;
      profileId: string;
      publicIdentityKey: string;
      nonce: string;
      qrMac: string;
    };
    createdAt: Date | string;
    expiresAt: Date | string;
  };
  if (flow.kind !== "device_activation" || !flow.deviceActivation || !flow.flowId) {
    return null;
  }
  return {
    flowId: flow.flowId,
    instanceId: flow.deviceActivation.instanceId,
    profileId: flow.deviceActivation.profileId,
    publicIdentityKey: flow.deviceActivation.publicIdentityKey,
    nonce: flow.deviceActivation.nonce,
    qrMac: flow.deviceActivation.qrMac,
    createdAt: flow.createdAt,
    expiresAt: flow.expiresAt,
  };
}

async function loadDeviceActivation(
  instanceId: string,
): Promise<DeviceActivation | null> {
  const entry = (await deviceActivationsKV.get(instanceId)).take();
  if (isErr(entry)) return null;
  return entry.value as unknown as DeviceActivation;
}

async function loadPortalDefault(key: string): Promise<PortalDefault | null> {
  const entry = (await portalDefaultsKV.get(key)).take();
  if (isErr(entry)) return null;
  return entry.value as PortalDefault;
}

async function loadLoginPortalSelection(
  contractId: string,
): Promise<LoginPortalSelection | null> {
  const entry =
    (await loginPortalSelectionsKV.get(loginSelectionKey(contractId))).take();
  if (isErr(entry)) return null;
  return entry.value as LoginPortalSelection;
}

async function loadDevicePortalSelection(
  profileId: string,
): Promise<DevicePortalSelection | null> {
  const entry =
    (await devicePortalSelectionsKV.get(deviceSelectionKey(profileId))).take();
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

async function listInstanceGrantPolicies(): Promise<InstanceGrantPolicy[]> {
  const iter = (await instanceGrantPoliciesKV.keys(">"))?.take();
  if (isErr(iter)) return [];
  const values: InstanceGrantPolicy[] = [];
  for await (const key of iter) {
    const entry = (await instanceGrantPoliciesKV.get(key)).take();
    if (!isErr(entry)) values.push(entry.value as InstanceGrantPolicy);
  }
  values.sort((left, right) => left.contractId.localeCompare(right.contractId));
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
    if (!isErr(entry)) values.push(entry.value as unknown as DeviceProfile);
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
    if (!isErr(entry)) values.push(entry.value as unknown as DeviceInstance);
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
    if (!isErr(entry)) values.push(entry.value as unknown as DeviceActivation);
  }
  values.sort((left, right) => left.instanceId.localeCompare(right.instanceId));
  return values;
}

async function listDeviceActivationReviews(): Promise<
  DeviceActivationReviewRecord[]
> {
  const iter = (await deviceActivationReviewsKV.keys(">"))?.take();
  if (isErr(iter)) return [];
  const values: DeviceActivationReviewRecord[] = [];
  for await (const key of iter) {
    const entry = (await deviceActivationReviewsKV.get(key)).take();
    if (!isErr(entry)) {
      values.push(entry.value as unknown as DeviceActivationReviewRecord);
    }
  }
  values.sort((left, right) => left.reviewId.localeCompare(right.reviewId));
  return values;
}

function toPublicReview(
  review: DeviceActivationReviewRecord,
): DeviceActivationReview {
  return {
    reviewId: review.reviewId,
    linkRequestId: review.linkRequestId,
    instanceId: review.instanceId,
    publicIdentityKey: review.publicIdentityKey,
    profileId: review.profileId,
    state: review.state,
    requestedAt: review.requestedAt instanceof Date
      ? review.requestedAt.toISOString()
      : review.requestedAt,
    decidedAt: review.decidedAt instanceof Date
      ? review.decidedAt.toISOString()
      : review.decidedAt,
    ...(review.reason ? { reason: review.reason } : {}),
  };
}

function policyActor(caller: RpcUser): InstanceGrantPolicyActor | undefined {
  if (!caller.origin || !caller.id) return undefined;
  return { origin: caller.origin, id: caller.id };
}

async function loadUserProjection(
  trellisId: string,
): Promise<UserProjectionEntry | null> {
  const entry = (await usersKV.get(trellisId)).take();
  if (isErr(entry)) return null;
  return entry.value as UserProjectionEntry;
}

async function revokeUserSessionByKey(
  sessionKeyId: string,
  session: Extract<Session, { type: "user" }>,
  revokedBy?: string,
): Promise<void> {
  const sessionKey = sessionKeyId.split(".")[0];
  if (!sessionKey) return;

  const connIter =
    (await connectionsKV.keys(`${sessionKey}.${session.trellisId}.>`)).take();
  if (!isErr(connIter)) {
    for await (const connKey of connIter) {
      const entry = (await connectionsKV.get(connKey)).take();
      if (!isErr(entry)) {
        await kick(entry.value.serverId, entry.value.clientId);
      }
      await connectionsKV.delete(connKey);
    }
  }

  if (revokedBy) {
    (
      await trellis.publish("Auth.SessionRevoked", {
        origin: session.origin,
        id: session.id,
        sessionKey,
        revokedBy,
      })
    ).inspectErr((error) =>
      logger.warn({ error }, "Failed to publish Auth.SessionRevoked")
    );
  }
  await sessionKV.delete(sessionKeyId);
}

async function kickInstanceRuntimeAccess(instanceKey: string): Promise<void> {
  const connIter = (await connectionsKV.keys(`${instanceKey}.>.>`)).take();
  if (!isErr(connIter)) {
    for await (const connKey of connIter) {
      const entry = (await connectionsKV.get(connKey)).take();
      if (!isErr(entry)) {
        await kick(entry.value.serverId, entry.value.clientId);
      }
      await connectionsKV.delete(connKey);
    }
  }

  const sessionIter = (await sessionKV.keys(`${instanceKey}.>`)).take();
  if (!isErr(sessionIter)) {
    for await (const sessionKeyId of sessionIter) {
      await sessionKV.delete(sessionKeyId);
    }
  }
}

async function revokeInvalidatedInstanceGrantSessions(args: {
  contractId: string;
  policies: InstanceGrantPolicy[];
  revokedBy?: string;
}): Promise<void> {
  const iter = (await sessionKV.keys(">")).take();
  if (isErr(iter)) return;

  for await (const key of iter) {
    const entry = (await sessionKV.get(key)).take();
    if (isErr(entry)) continue;
    const session = entry.value as Session;
    if (session.type !== "user") continue;
    if (session.contractId !== args.contractId) continue;

    const projection = await loadUserProjection(session.trellisId);
    const storedApprovalEntry = (await contractApprovalsKV.get(
      `${session.trellisId}.${session.contractDigest}`,
    )).take();
    const storedApproval = isErr(storedApprovalEntry)
      ? null
      : storedApprovalEntry.value;
    const matchedPolicies = matchingInstanceGrantPolicies({
      policies: args.policies,
      contractId: session.contractId,
      appOrigin: session.appOrigin,
    });
    const sessionAllowed = projection !== null &&
      userDelegationAllowed({
        active: projection.active,
        explicitCapabilities: projection.capabilities ?? [],
        delegatedCapabilities: session.delegatedCapabilities,
        storedApproval,
        matchedPolicies,
      });
    if (sessionAllowed) continue;

    await revokeUserSessionByKey(key, session, args.revokedBy);
  }
}

async function confirmationCodeForReview(
  review: DeviceActivationReviewRecord,
): Promise<string | null> {
  const flow = await loadDeviceActivationFlow(review.flowId);
  const provisioningSecret = await loadDeviceProvisioningSecret(
    review.instanceId,
  );
  if (!flow || !provisioningSecret) return null;
  return await deriveDeviceConfirmationCode({
    activationKey: provisioningSecret.activationKey,
    publicIdentityKey: review.publicIdentityKey,
    nonce: flow.nonce,
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
    logger.trace(
      { rpc: "Auth.CreatePortal", portalId: req.portalId },
      "RPC request",
    );
    if (!isAdmin(caller)) return insufficientPermissions();
    const validation = validatePortalRequest(req);
    if (validation.isErr()) return validation;
    const { portal } = validation.take() as { portal: Portal };
    await portalsKV.put(portal.portalId, portal);
    return Result.ok({ portal });
  };
}

export const authListPortalsHandler = async (
  _req: unknown,
  { caller }: { caller: RpcUser },
) => {
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

export const authGetLoginPortalDefaultHandler = async (
  _req: unknown,
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({
    defaultPortal: (await loadPortalDefault(LOGIN_DEFAULT_KEY)) ??
      { portalId: null },
  });
};

export const authListInstanceGrantPoliciesHandler = async (
  _req: unknown,
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({ policies: await listInstanceGrantPolicies() });
};

export const authUpsertInstanceGrantPolicyHandler = async (
  req: UpsertInstanceGrantPolicyRequest,
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const validation = validateInstanceGrantPolicyRequest(req);
  if (validation.isErr()) return validation;
  const { policy: normalizedPolicy } = validation.take() as {
    policy: Pick<
      InstanceGrantPolicy,
      "contractId" | "allowedOrigins" | "impliedCapabilities"
    >;
  };
  const existing = await loadInstanceGrantPolicy(normalizedPolicy.contractId);
  const now = new Date().toISOString();
  const actor = policyActor(caller);
  const policy: InstanceGrantPolicy = {
    contractId: normalizedPolicy.contractId,
    ...(normalizedPolicy.allowedOrigins
      ? { allowedOrigins: normalizedPolicy.allowedOrigins }
      : {}),
    impliedCapabilities: normalizedPolicy.impliedCapabilities,
    disabled: false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    source: {
      kind: "admin_policy",
      ...(existing?.source.createdBy || actor
        ? { createdBy: existing?.source.createdBy ?? actor }
        : {}),
      ...(actor
        ? { updatedBy: actor }
        : existing?.source.updatedBy
        ? { updatedBy: existing.source.updatedBy }
        : {}),
    },
  };
  await instanceGrantPoliciesKV.put(policy.contractId, policy);
  await revokeInvalidatedInstanceGrantSessions({
    contractId: policy.contractId,
    policies: await listInstanceGrantPolicies(),
    revokedBy: actor ? `${actor.origin}.${actor.id}` : undefined,
  });
  return Result.ok({ policy });
};

export const authDisableInstanceGrantPolicyHandler = async (
  req: { contractId: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  if (!req.contractId) return invalidRequest({ contractId: req.contractId });
  const existing = await loadInstanceGrantPolicy(req.contractId);
  if (!existing) {
    return invalidRequest({
      contractId: req.contractId,
      reason: "instance_grant_policy_not_found",
    });
  }
  const actor = policyActor(caller);
  const policy: InstanceGrantPolicy = {
    ...existing,
    disabled: true,
    updatedAt: new Date().toISOString(),
    source: {
      ...existing.source,
      ...(actor ? { updatedBy: actor } : {}),
    },
  };
  await instanceGrantPoliciesKV.put(policy.contractId, policy);
  await revokeInvalidatedInstanceGrantSessions({
    contractId: policy.contractId,
    policies: await listInstanceGrantPolicies(),
    revokedBy: actor ? `${actor.origin}.${actor.id}` : undefined,
  });
  return Result.ok({ policy });
};

export const authSetLoginPortalDefaultHandler = async (
  req: PortalDefaultRequest,
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const validation = validatePortalDefaultRequest(req);
  if (validation.isErr()) return validation;
  const { defaultPortal } = validation.take() as {
    defaultPortal: PortalDefault;
  };
  const referenceCheck = await ensurePortalReference(defaultPortal.portalId);
  if (referenceCheck.isErr()) return referenceCheck;
  await portalDefaultsKV.put(LOGIN_DEFAULT_KEY, defaultPortal);
  return Result.ok({ defaultPortal });
};

export const authListLoginPortalSelectionsHandler = async (
  _req: unknown,
  { caller }: { caller: RpcUser },
) => {
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
  const { selection } = validation.take() as {
    selection: LoginPortalSelection;
  };
  const referenceCheck = await ensurePortalReference(selection.portalId);
  if (referenceCheck.isErr()) return referenceCheck;
  await loginPortalSelectionsKV.put(
    loginSelectionKey(selection.contractId),
    selection,
  );
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

export const authGetDevicePortalDefaultHandler = async (
  _req: unknown,
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  return Result.ok({
    defaultPortal: (await loadPortalDefault(DEVICE_DEFAULT_KEY)) ??
      { portalId: null },
  });
};

export const authSetDevicePortalDefaultHandler = async (
  req: PortalDefaultRequest,
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const validation = validatePortalDefaultRequest(req);
  if (validation.isErr()) return validation;
  const { defaultPortal } = validation.take() as {
    defaultPortal: PortalDefault;
  };
  const referenceCheck = await ensurePortalReference(defaultPortal.portalId);
  if (referenceCheck.isErr()) return referenceCheck;
  await portalDefaultsKV.put(DEVICE_DEFAULT_KEY, defaultPortal);
  return Result.ok({ defaultPortal });
};

export const authListDevicePortalSelectionsHandler = async (
  _req: unknown,
  { caller }: { caller: RpcUser },
) => {
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
  const { selection } = validation.take() as {
    selection: DevicePortalSelection;
  };
  const profile = await loadDeviceProfile(selection.profileId);
  if (!profile || profile.disabled) {
    return invalidRequest({
      profileId: selection.profileId,
      reason: "device_profile_not_found",
    });
  }
  const referenceCheck = await ensurePortalReference(selection.portalId);
  if (referenceCheck.isErr()) return referenceCheck;
  await devicePortalSelectionsKV.put(
    deviceSelectionKey(selection.profileId),
    selection,
  );
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
  installDeviceContract: (
    contract: unknown,
  ) => Promise<
    { id: string; digest: string; displayName: string; description: string }
  >;
  refreshActiveContracts: () => Promise<void>;
}) {
  return async (
    req: Parameters<typeof validateDeviceProfileRequest>[0],
    { caller }: { caller: RpcUser },
  ) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const validation = validateDeviceProfileRequest(req);
    if (validation.isErr()) return validation;
    const { profile } = validation.take() as { profile: DeviceProfile };
    await deviceProfilesKV.put(profile.profileId, profile);
    return Result.ok({ profile });
  };
}

export const authListDeviceProfilesHandler = async (
  req: { disabled?: boolean },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  let profiles = await listDeviceProfiles();
  if (req.disabled !== undefined) {
    profiles = profiles.filter((profile) => profile.disabled === req.disabled);
  }
  return Result.ok({ profiles });
};

export function createAuthApplyDeviceProfileContractHandler(deps: {
  installDeviceContract: (
    contract: unknown,
  ) => Promise<
    { id: string; digest: string; displayName: string; description: string }
  >;
}) {
  return async (
    req: { profileId: string; contract: unknown },
    { caller }: { caller: RpcUser },
  ) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const profile = await loadDeviceProfile(req.profileId);
    if (!profile) {
      return invalidRequest({
        profileId: req.profileId,
        reason: "device_profile_not_found",
      });
    }
    let installed;
    try {
      installed = await deps.installDeviceContract(req.contract);
    } catch (error) {
      return invalidRequest({
        profileId: req.profileId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const nextProfile: DeviceProfile = {
      ...profile,
      appliedContracts: normalizeAppliedContracts([
        ...profile.appliedContracts,
        { contractId: installed.id, allowedDigests: [installed.digest] },
      ]),
    };
    await deviceProfilesKV.put(nextProfile.profileId, nextProfile);
    return Result.ok({
      profile: nextProfile,
      contract: {
        digest: installed.digest,
        id: installed.id,
        displayName: installed.displayName,
        description: installed.description,
        installedAt: new Date().toISOString(),
      },
    });
  };
}

export function createAuthUnapplyDeviceProfileContractHandler() {
  return async (
    req: { profileId: string; contractId: string; digests?: string[] },
    { caller }: { caller: RpcUser },
  ) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const profile = await loadDeviceProfile(req.profileId);
    if (!profile) {
      return invalidRequest({
        profileId: req.profileId,
        reason: "device_profile_not_found",
      });
    }
    const removeDigests = new Set(req.digests ?? []);
    const nextProfile: DeviceProfile = {
      ...profile,
      appliedContracts: normalizeAppliedContracts(
        profile.appliedContracts
          .map((applied) => {
            if (applied.contractId !== req.contractId) return applied;
            if (removeDigests.size === 0) return null;
            const remaining = applied.allowedDigests.filter((digest) =>
              !removeDigests.has(digest)
            );
            return remaining.length > 0
              ? { ...applied, allowedDigests: remaining }
              : null;
          })
          .filter((value): value is NonNullable<typeof value> =>
            value !== null
          ),
      ),
    };
    await deviceProfilesKV.put(nextProfile.profileId, nextProfile);
    const instances = (await listDeviceInstances()).filter((instance) =>
      instance.profileId === profile.profileId
    );
    for (const instance of instances) {
      if (instance.currentContractId !== req.contractId) continue;
      if (
        removeDigests.size > 0 && instance.currentContractDigest &&
        !removeDigests.has(instance.currentContractDigest)
      ) continue;
      await kickInstanceRuntimeAccess(instance.publicIdentityKey);
    }
    return Result.ok({ profile: nextProfile });
  };
}

export const authDisableDeviceProfileHandler = async (
  req: { profileId: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const profile = await loadDeviceProfile(req.profileId);
  if (!profile) {
    return invalidRequest({
      profileId: req.profileId,
      reason: "device_profile_not_found",
    });
  }
  const nextProfile = { ...profile, disabled: true };
  await deviceProfilesKV.put(req.profileId, nextProfile);
  for (
    const instance of (await listDeviceInstances()).filter((entry) =>
      entry.profileId === req.profileId
    )
  ) {
    await kickInstanceRuntimeAccess(instance.publicIdentityKey);
  }
  return Result.ok({ profile: nextProfile });
};

export const authEnableDeviceProfileHandler = async (
  req: { profileId: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const profile = await loadDeviceProfile(req.profileId);
  if (!profile) {
    return invalidRequest({
      profileId: req.profileId,
      reason: "device_profile_not_found",
    });
  }
  const nextProfile = { ...profile, disabled: false };
  await deviceProfilesKV.put(req.profileId, nextProfile);
  return Result.ok({ profile: nextProfile });
};

export const authRemoveDeviceProfileHandler = async (
  req: { profileId: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const inUse = (await listDeviceInstances()).some((instance) =>
    instance.profileId === req.profileId
  );
  if (inUse) {
    return invalidRequest({
      profileId: req.profileId,
      reason: "device_profile_in_use",
    });
  }
  await deviceProfilesKV.delete(req.profileId);
  return Result.ok({ success: true });
};

export function createAuthProvisionDeviceInstanceHandler() {
  return async (
    req: ProvisionDeviceInstanceRequest,
    { caller }: { caller: RpcUser },
  ) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const validation = validateDeviceProvisionRequest(req);
    if (validation.isErr()) return validation;
    const { instance, provisioningSecret } = validation.take() as {
      instance: DeviceInstance;
      provisioningSecret: DeviceProvisioningSecret;
    };
    const profile = await loadDeviceProfile(instance.profileId);
    if (!profile || profile.disabled) {
      return invalidRequest({
        profileId: instance.profileId,
        reason: "device_profile_not_found",
      });
    }
    await deviceInstancesKV.put(instance.instanceId, instance);
    await deviceProvisioningSecretsKV.put(
      instance.instanceId,
      provisioningSecret,
    );
    return Result.ok({ instance });
  };
}

export const authListDeviceInstancesHandler = async (
  req: { profileId?: string; state?: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  let instances = await listDeviceInstances();
  if (req.profileId) {
    instances = instances.filter((instance) =>
      instance.profileId === req.profileId
    );
  }
  if (req.state) {
    instances = instances.filter((instance) => instance.state === req.state);
  }
  return Result.ok({ instances });
};

export const authDisableDeviceInstanceHandler = async (
  req: { instanceId: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const instance = await loadDeviceInstance(req.instanceId);
  if (!instance) {
    return invalidRequest({
      instanceId: req.instanceId,
      reason: "unknown_device",
    });
  }
  const nextInstance = { ...instance, state: "disabled" as const };
  await deviceInstancesKV.put(req.instanceId, nextInstance);
  await kickInstanceRuntimeAccess(instance.publicIdentityKey);
  return Result.ok({ instance: nextInstance });
};

export const authEnableDeviceInstanceHandler = async (
  req: { instanceId: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const instance = await loadDeviceInstance(req.instanceId);
  if (!instance) {
    return invalidRequest({
      instanceId: req.instanceId,
      reason: "unknown_device",
    });
  }
  const activation = await loadDeviceActivation(req.instanceId);
  const nextState: DeviceInstance["state"] =
    activation && activation.state === "activated" &&
      activation.revokedAt === null
      ? "activated"
      : "registered";
  const nextInstance = { ...instance, state: nextState };
  await deviceInstancesKV.put(req.instanceId, nextInstance);
  return Result.ok({ instance: nextInstance });
};

export const authRemoveDeviceInstanceHandler = async (
  req: { instanceId: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  const instance = await loadDeviceInstance(req.instanceId);
  if (!instance) {
    return invalidRequest({
      instanceId: req.instanceId,
      reason: "unknown_device",
    });
  }
  await kickInstanceRuntimeAccess(instance.publicIdentityKey);
  await deviceInstancesKV.delete(req.instanceId);
  await deviceProvisioningSecretsKV.delete(req.instanceId);
  await deviceActivationsKV.delete(req.instanceId);
  return Result.ok({ success: true });
};

export const authListDeviceActivationsHandler = async (
  req: { instanceId?: string; profileId?: string; state?: string },
  { caller }: { caller: RpcUser },
) => {
  if (!isAdmin(caller)) return insufficientPermissions();
  let activations = await listDeviceActivations();
  if (req.instanceId) {
    activations = activations.filter((activation) =>
      activation.instanceId === req.instanceId
    );
  }
  if (req.profileId) {
    activations = activations.filter((activation) =>
      activation.profileId === req.profileId
    );
  }
  if (req.state) {
    activations = activations.filter((activation) =>
      activation.state === req.state
    );
  }
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
    ...(activation.value as unknown as DeviceActivation),
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
  const allowedProfiles = reviewableProfiles(caller);
  if (
    allowedProfiles !== null && req.profileId &&
    !allowedProfiles.has(req.profileId)
  ) {
    return insufficientPermissions();
  }
  let reviews = await listDeviceActivationReviews();
  if (req.instanceId) {
    reviews = reviews.filter((review) => review.instanceId === req.instanceId);
  }
  if (req.profileId) {
    reviews = reviews.filter((review) => review.profileId === req.profileId);
  }
  if (req.state) {
    reviews = reviews.filter((review) => review.state === req.state);
  }
  if (allowedProfiles !== null) {
    reviews = reviews.filter((review) => allowedProfiles.has(review.profileId));
  }
  return Result.ok({ reviews: reviews.map(toPublicReview) });
};

export const authDecideDeviceActivationReviewHandler = async (
  req: { reviewId: string; decision: "approve" | "reject"; reason?: string },
  { caller }: { caller: RpcUser },
) => {
  const review = await loadDeviceActivationReview(req.reviewId);
  if (!review) {
    return invalidRequest({
      reviewId: req.reviewId,
      reason: "device_review_not_found",
    });
  }
  if (!canReviewProfile(caller, review.profileId)) {
    return insufficientPermissions();
  }

  if (review.state !== "pending") {
    const activation = review.state === "approved"
      ? await loadDeviceActivation(review.instanceId)
      : null;
    const confirmationCode = review.state === "approved"
      ? await confirmationCodeForReview(review)
      : null;
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
    return invalidRequest({
      instanceId: review.instanceId,
      reason: "unknown_device",
    });
  }
  if (!profile || profile.disabled) {
    return invalidRequest({
      profileId: review.profileId,
      reason: "device_profile_not_found",
    });
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
