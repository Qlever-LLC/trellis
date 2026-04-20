import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";
import type { AsyncResult, BaseError } from "@qlever-llc/result";

import { planUserContractApproval } from "../approval/plan.ts";
import {
  effectiveApproval,
  effectiveCapabilities,
  getAppOrigin,
  matchingInstanceGrantPolicies,
  missingCapabilities,
  type EffectiveApproval,
} from "../grants/policy.ts";
import type { Config } from "../../config.ts";
import type { ContractStore } from "../../catalog/store.ts";
import type {
  AppIdentity,
  ContractApprovalRecord,
  InstanceGrantPolicy,
  OAuthState,
  PendingAuth,
  UserProjectionEntry,
} from "../../state/schemas.ts";

export type OAuthStateEntry = {
  value: OAuthState;
  delete: (cas?: boolean) => AsyncResult<unknown, BaseError>;
};

export type PendingAuthEntry = {
  value: PendingAuth;
  delete: (cas?: boolean) => AsyncResult<unknown, BaseError>;
};

export type ApprovalResolution = {
  plan: Awaited<ReturnType<typeof planUserContractApproval>>;
  trellisId: string;
  userOrigin: string;
  userId: string;
  userEmail: string;
  userName: string;
  app?: AppIdentity;
  existingProjection: UserProjectionEntry | null;
  existingCapabilities: string[];
  effectiveCapabilities: string[];
  missingCapabilities: string[];
  matchedPolicies: InstanceGrantPolicy[];
  effectiveApproval: EffectiveApproval;
  storedApproval: ContractApprovalRecord | null;
};

export type ApprovalResolutionWithStoredApproval = ApprovalResolution & {
  storedApproval: ContractApprovalRecord;
};

export type PortalRecord = {
  portalId: string;
  entryUrl: string;
  disabled?: boolean;
};

export type LoginPortalSelectionRecord = {
  contractId: string;
  portalId: string | null;
};

export type DevicePortalSelectionRecord = {
  profileId: string;
  portalId: string | null;
};

export type ResolvedPortal =
  | { kind: "builtin" }
  | { kind: "custom"; portal: PortalRecord };

const BUILTIN_LOGIN_PORTAL_PATH = "/_trellis/portal/users/login";
const BUILTIN_DEVICE_PORTAL_PATH = "/_trellis/portal/devices/activate";

function enabledPortalById(portals: PortalRecord[]): Map<string, PortalRecord> {
  return new Map(portals.filter((portal) => !portal.disabled).map((portal) => [portal.portalId, portal]));
}

export function getApprovalResolutionBlocker(
  resolution: ApprovalResolution,
): "user_inactive" | null {
  return resolution.existingProjection?.active === false ? "user_inactive" : null;
}

export type ApprovalResolutionDeps = {
  loadStoredApproval: (key: string) => Promise<ContractApprovalRecord | null>;
  loadUserProjection: (trellisId: string) => Promise<UserProjectionEntry | null>;
  loadInstanceGrantPolicies?: (contractId: string) => Promise<InstanceGrantPolicy[]>;
};

export type WarnLogger = {
  warn: (context: Record<string, unknown>, message: string) => void;
};

export type CookieContext = {
  req: { header: (name: string) => string | undefined };
  header: (name: string, value: string) => void;
  json: (body: unknown, status?: number) => Response;
  redirect: (location: string) => Response;
};

export function contractApprovalKey(userTrellisId: string, contractDigest: string): string {
  return `${userTrellisId}.${contractDigest}`;
}

export function applyApprovalDecision(args: {
  resolution: ApprovalResolution;
  approved: boolean;
  answeredAt: Date;
}): ApprovalResolutionWithStoredApproval {
  const storedApproval: ContractApprovalRecord = {
    userTrellisId: args.resolution.trellisId,
    origin: args.resolution.userOrigin,
    id: args.resolution.userId,
    answer: args.approved ? "approved" : "denied",
    answeredAt: args.answeredAt,
    updatedAt: args.answeredAt,
    approval: args.resolution.plan.approval,
    publishSubjects: args.resolution.plan.publishSubjects,
    subscribeSubjects: args.resolution.plan.subscribeSubjects,
  };
  return {
    ...args.resolution,
    effectiveApproval: args.resolution.matchedPolicies.length > 0
      ? { kind: "admin_policy", answer: "approved" }
      : { kind: "stored_approval", answer: storedApproval.answer },
    storedApproval,
  };
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function decodeContractQuery(value: string): Record<string, unknown> {
  const decoded = new TextDecoder().decode(decodeBase64Url(value));
  const parsed = JSON.parse(decoded);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid contract payload");
  }
  return parsed as Record<string, unknown>;
}

export function decodeOpenObjectQuery(value: string): Record<string, unknown> {
  const decoded = new TextDecoder().decode(decodeBase64Url(value));
  const parsed = JSON.parse(decoded);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid JSON payload");
  }
  return parsed as Record<string, unknown>;
}

export function buildRedirectLocation(target: string, values: Record<string, string>): string {
  const relative = target.startsWith("/");
  const url = relative ? new URL(target, "http://trellis.local") : new URL(target);
  for (const [key, value] of Object.entries(values)) {
    url.searchParams.set(key, value);
  }
  return relative ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

export function buildAppIdentity(args: {
  contractId: string;
  redirectTo: string;
}): AppIdentity {
  const origin = getAppOrigin(args.redirectTo);
  return {
    contractId: args.contractId,
    ...(origin ? { origin } : {}),
  };
}

export function resolveLoginPortal(args: {
  contractId: string;
  portals: PortalRecord[];
  defaultPortalId?: string | null;
  selections: LoginPortalSelectionRecord[];
}): ResolvedPortal {
  const portalById = enabledPortalById(args.portals);
  const selection = args.selections.find((entry) => entry.contractId === args.contractId);
  if (selection) {
    if (selection.portalId === null) return { kind: "builtin" };
    const portal = portalById.get(selection.portalId);
    if (portal) return { kind: "custom", portal };
  }

  if (args.defaultPortalId === null || args.defaultPortalId === undefined) {
    return { kind: "builtin" };
  }

  const defaultPortal = portalById.get(args.defaultPortalId);
  return defaultPortal ? { kind: "custom", portal: defaultPortal } : { kind: "builtin" };
}

export function resolveDevicePortal(args: {
  profileId: string;
  portals: PortalRecord[];
  defaultPortalId?: string | null;
  selections: DevicePortalSelectionRecord[];
}): ResolvedPortal {
  const portalById = enabledPortalById(args.portals);
  const selection = args.selections.find((entry) => entry.profileId === args.profileId);
  if (selection) {
    if (selection.portalId === null) return { kind: "builtin" };
    const portal = portalById.get(selection.portalId);
    if (portal) return { kind: "custom", portal };
  }

  if (args.defaultPortalId === null || args.defaultPortalId === undefined) {
    return { kind: "builtin" };
  }

  const defaultPortal = portalById.get(args.defaultPortalId);
  return defaultPortal ? { kind: "custom", portal: defaultPortal } : { kind: "builtin" };
}

export function normalizeBuiltinPortalEntryUrl(args: {
  entryUrl: string;
  baseUrl: string;
  expectedKind: "login" | "device";
}): string {
  const expectedPath = args.expectedKind === "login"
    ? BUILTIN_LOGIN_PORTAL_PATH
    : BUILTIN_DEVICE_PORTAL_PATH;
  const oppositePath = args.expectedKind === "login"
    ? BUILTIN_DEVICE_PORTAL_PATH
    : BUILTIN_LOGIN_PORTAL_PATH;

  try {
    const entryUrl = new URL(args.entryUrl);
    const baseUrl = new URL(args.baseUrl);
    if (entryUrl.origin !== baseUrl.origin || entryUrl.pathname !== oppositePath) {
      return args.entryUrl;
    }

    return new URL(expectedPath, baseUrl).toString();
  } catch {
    return args.entryUrl;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function getApprovalResolution(
  contractStore: ContractStore,
  pending: PendingAuth,
  deps: ApprovalResolutionDeps,
): Promise<ApprovalResolution> {
  const plan = await planUserContractApproval(contractStore, pending.contract);
  const trellisId = await trellisIdFromOriginId(pending.user.origin, pending.user.id);
  const userEmail = pending.user.email ?? `${pending.user.origin}:${pending.user.id}`;
  const userName = pending.user.name ?? pending.user.id;
  const app = pending.app ?? buildAppIdentity({
    contractId: plan.contract.id,
    redirectTo: pending.redirectTo,
  });
  const existingProjection = await deps.loadUserProjection(trellisId);
  const existingCapabilities = existingProjection?.capabilities ?? [];
  const storedApproval = await deps.loadStoredApproval(
    contractApprovalKey(trellisId, plan.digest),
  );
  const matchedPolicies = matchingInstanceGrantPolicies({
    policies: await (deps.loadInstanceGrantPolicies?.(plan.contract.id) ?? Promise.resolve([])),
    contractId: plan.contract.id,
    appOrigin: app.origin,
  });
  const resolvedCapabilities = effectiveCapabilities({
    explicitCapabilities: existingCapabilities,
    matchedPolicies,
  });
  const resolvedApproval = effectiveApproval({
    storedApproval,
    matchedPolicies,
  });
  const unresolvedCapabilities = missingCapabilities({
    requiredCapabilities: plan.approval.capabilities,
    effectiveCapabilities: resolvedCapabilities,
  });

  return {
    plan,
    trellisId,
    userOrigin: pending.user.origin,
    userId: pending.user.id,
    userEmail,
    userName,
    app,
    existingProjection,
    existingCapabilities,
    effectiveCapabilities: resolvedCapabilities,
    missingCapabilities: unresolvedCapabilities,
    matchedPolicies,
    effectiveApproval: resolvedApproval,
    storedApproval,
  };
}

export function getCookie(c: CookieContext, name: string): string | null {
  const header = c.req.header("Cookie");
  if (!header) return null;
  const parts = header.split(";").map((part) => part.trim());
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq);
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1));
    } catch {
      return null;
    }
  }
  return null;
}

export function setCookie(
  c: CookieContext,
  name: string,
  value: string,
  opts: {
    maxAgeSeconds: number;
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Lax" | "Strict" | "None";
  },
): void {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path}`,
    `Max-Age=${opts.maxAgeSeconds}`,
    `SameSite=${opts.sameSite}`,
  ];
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  c.header("Set-Cookie", parts.join("; "));
}

export function shouldUseSecureOauthCookie(
  currentConfig: Config,
  deps: { logger?: WarnLogger } = {},
): boolean {
  const configuredLocation = currentConfig.web.publicOrigin ??
    currentConfig.oauth.redirectBase;
  try {
    const url = new URL(configuredLocation);
    if (url.protocol === "https:") return true;
    if (url.protocol === "http:") {
      if (isLoopbackHostname(url.hostname)) {
        return false;
      }
      return !currentConfig.web.allowInsecureOrigins.includes(url.origin);
    }
  } catch {
    deps.logger?.warn(
      { origin: configuredLocation },
      "Failed to parse auth public origin for cookie policy",
    );
  }
  return true;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}
