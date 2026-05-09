import {
  approvalCapabilityKeys,
  trellisIdFromOriginId,
} from "@qlever-llc/trellis/auth";
import type { AsyncResult, BaseError } from "@qlever-llc/result";

import { planUserContractApproval } from "../approval/plan.ts";
import { analyzeContractEnvelopeBoundary } from "../boundary_analysis.ts";
import { applyGrantOverrideCapabilities } from "../envelope_decision.ts";
import {
  type EffectiveApproval,
  effectiveApproval,
  getAppOrigin,
  missingCapabilities,
} from "../grants/policy.ts";
import type { Config } from "../../config.ts";
import type { ContractsModule } from "../../catalog/runtime.ts";
import type {
  AppIdentity,
  DeploymentEnvelope,
  DeploymentGrantOverride,
  EnvelopeBoundary,
  IdentityAnchor,
  IdentityEnvelopeRecord,
  OAuthState,
  PendingAuth,
  UserProjectionEntry,
} from "../schemas.ts";

const EMPTY_BOUNDARY: EnvelopeBoundary = {
  contracts: [],
  surfaces: [],
  capabilities: [],
  resources: [],
};

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
  sessionPublicKey: string;
  app?: AppIdentity;
  existingProjection: UserProjectionEntry | null;
  existingCapabilities: string[];
  effectiveCapabilities: string[];
  missingCapabilities: string[];
  matchedPolicies: [];
  effectiveApproval: EffectiveApproval;
  storedApproval: IdentityEnvelopeRecord | null;
  requestedBoundary?: EnvelopeBoundary;
  systemAvailabilityEnvelope?: EnvelopeBoundary;
};

export type ApprovalResolutionWithStoredApproval = ApprovalResolution & {
  storedApproval: IdentityEnvelopeRecord;
};

export function getApprovalResolutionBlocker(
  resolution: ApprovalResolution,
): "user_inactive" | null {
  return resolution.existingProjection?.active === false
    ? "user_inactive"
    : null;
}

export type ApprovalResolutionDeps = {
  loadUserProjection: (
    trellisId: string,
  ) => Promise<UserProjectionEntry | null>;
  loadDeploymentEnvelopes?: () => Promise<DeploymentEnvelope[]>;
  loadDeploymentGrantOverrides?: (
    deploymentId: string,
  ) => Promise<DeploymentGrantOverride[]>;
  loadIdentityEnvelopesByUser?: (
    userTrellisId: string,
  ) => Promise<IdentityEnvelopeRecord[]>;
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

export function identityAnchorForApp(
  app: AppIdentity,
  sessionPublicKey: string,
): IdentityAnchor {
  return app.origin
    ? { kind: "web", contractId: app.contractId, origin: app.origin }
    : { kind: "cli", contractId: app.contractId, sessionPublicKey };
}

export function identityEnvelopeIdForAnchor(
  userTrellisId: string,
  anchor: IdentityAnchor,
): string {
  return encodeBase64Url(
    new TextEncoder().encode(`${userTrellisId}:${JSON.stringify(anchor)}`),
  );
}

export function applyApprovalDecision(args: {
  resolution: ApprovalResolution;
  approved: boolean;
  answeredAt: Date;
}): ApprovalResolutionWithStoredApproval {
  const app = args.resolution.app ?? {
    contractId: args.resolution.plan.contract.id,
  };
  const identityAnchor = identityAnchorForApp(
    app,
    args.resolution.sessionPublicKey,
  );
  const storedApproval: IdentityEnvelopeRecord = {
    identityEnvelopeId: identityEnvelopeIdForAnchor(
      args.resolution.trellisId,
      identityAnchor,
    ),
    userTrellisId: args.resolution.trellisId,
    origin: args.resolution.userOrigin,
    id: args.resolution.userId,
    identityAnchor,
    answer: args.approved ? "approved" : "denied",
    answeredAt: args.answeredAt,
    updatedAt: args.answeredAt,
    approvalEvidence: args.resolution.plan.approval,
    publishSubjects: args.resolution.plan.publishSubjects,
    subscribeSubjects: args.resolution.plan.subscribeSubjects,
  };
  return {
    ...args.resolution,
    effectiveApproval: effectiveApproval({
      storedApproval,
      matchedPolicies: [],
    }),
    storedApproval,
  };
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/g,
    "",
  );
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function decodeContractQuery(value: string): Record<string, unknown> {
  return decodeBase64JsonObjectQuery(value, "Invalid contract payload");
}

export function decodeOpenObjectQuery(value: string): Record<string, unknown> {
  return decodeBase64JsonObjectQuery(value, "Invalid JSON payload");
}

function decodeBase64JsonObjectQuery(
  value: string,
  invalidPayloadMessage: string,
): Record<string, unknown> {
  const decoded = new TextDecoder().decode(decodeBase64Url(value));
  const parsed = JSON.parse(decoded);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(invalidPayloadMessage);
  }
  return parsed as Record<string, unknown>;
}

export function buildRedirectLocation(
  target: string,
  values: Record<string, string>,
): string {
  const relative = target.startsWith("/");
  const url = relative
    ? new URL(target, "http://trellis.local")
    : new URL(target);
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

function mergeEnvelopeBoundaries(
  boundaries: EnvelopeBoundary[],
): EnvelopeBoundary {
  const contracts = new Map<string, EnvelopeBoundary["contracts"][number]>();
  const surfaces = new Map<string, EnvelopeBoundary["surfaces"][number]>();
  const resources = new Map<string, EnvelopeBoundary["resources"][number]>();
  const capabilities = new Set<string>();

  for (const boundary of boundaries) {
    for (const contract of boundary.contracts) {
      const existing = contracts.get(contract.contractId);
      contracts.set(contract.contractId, {
        ...contract,
        required: (existing?.required ?? false) || contract.required,
      });
    }
    for (const surface of boundary.surfaces) {
      const key = [
        surface.contractId,
        surface.kind,
        surface.name,
        surface.action,
      ].join("\u001f");
      const existing = surfaces.get(key);
      surfaces.set(key, {
        ...surface,
        required: (existing?.required ?? false) || surface.required,
      });
    }
    for (const resource of boundary.resources) {
      const key = [resource.kind, resource.alias].join("\u001f");
      const existing = resources.get(key);
      resources.set(key, {
        ...resource,
        required: (existing?.required ?? false) || resource.required,
      });
    }
    for (const capability of boundary.capabilities) {
      capabilities.add(capability);
    }
  }

  return {
    contracts: [...contracts.values()].sort((left, right) =>
      left.contractId.localeCompare(right.contractId)
    ),
    surfaces: [...surfaces.values()].sort((left, right) =>
      left.contractId.localeCompare(right.contractId) ||
      left.kind.localeCompare(right.kind) ||
      left.name.localeCompare(right.name) ||
      left.action.localeCompare(right.action)
    ),
    capabilities: [...capabilities].sort(),
    resources: [...resources.values()].sort((left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.alias.localeCompare(right.alias)
    ),
  };
}

function sameIdentityAnchor(
  left: IdentityAnchor,
  right: IdentityAnchor,
): boolean {
  if (left.kind !== right.kind || left.contractId !== right.contractId) {
    return false;
  }
  switch (left.kind) {
    case "web":
      return right.kind === "web" && left.origin === right.origin;
    case "cli":
    case "native":
      return right.kind === left.kind &&
        left.sessionPublicKey === right.sessionPublicKey;
    case "device-user":
      return right.kind === "device-user" &&
        left.devicePublicKey === right.devicePublicKey;
  }
}

function matchingGrantOverrideCapabilities(args: {
  overrides: DeploymentGrantOverride[];
  identity: Parameters<typeof applyGrantOverrideCapabilities>[2];
}): string[] {
  return applyGrantOverrideCapabilities(
    EMPTY_BOUNDARY,
    args.overrides,
    args.identity,
  )
    .capabilities;
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
  contracts: Pick<
    ContractsModule,
    | "getActiveContractsById"
    | "getActiveEntries"
    | "validateContract"
  >,
  pending: PendingAuth,
  deps: ApprovalResolutionDeps,
): Promise<ApprovalResolution> {
  const plan = await planUserContractApproval(contracts, pending.contract);
  const requestedBoundary = (await analyzeContractEnvelopeBoundary(
    contracts,
    pending.contract,
  )).required;
  const trellisId = await trellisIdFromOriginId(
    pending.user.origin,
    pending.user.id,
  );
  const userEmail = pending.user.email ??
    `${pending.user.origin}:${pending.user.id}`;
  const userName = pending.user.name ?? pending.user.id;
  const app = pending.app ?? buildAppIdentity({
    contractId: plan.contract.id,
    redirectTo: pending.redirectTo,
  });
  const requestedIdentity = app.origin
    ? { kind: "web" as const, contractId: app.contractId, origin: app.origin }
    : {
      kind: "cli" as const,
      contractId: app.contractId,
      sessionPublicKey: pending.sessionKey,
    };
  const enabledDeploymentEnvelopes =
    (await deps.loadDeploymentEnvelopes?.() ?? [])
      .filter((envelope) => !envelope.disabled);
  const systemAvailabilityEnvelope = mergeEnvelopeBoundaries(
    enabledDeploymentEnvelopes.map((envelope) => envelope.boundary),
  );
  const deploymentGrantOverrides = (
    await Promise.all(
      enabledDeploymentEnvelopes.map((envelope) =>
        deps.loadDeploymentGrantOverrides?.(envelope.deploymentId) ?? []
      ),
    )
  ).flat();
  const existingProjection = await deps.loadUserProjection(trellisId);
  const existingCapabilities = existingProjection?.capabilities ?? [];
  const storedApproval =
    (await deps.loadIdentityEnvelopesByUser?.(trellisId) ?? [])
      .find((approval) =>
        approval.userTrellisId === trellisId &&
        approval.origin === pending.user.origin &&
        approval.id === pending.user.id &&
        sameIdentityAnchor(
          approval.identityAnchor,
          identityAnchorForApp(app, pending.sessionKey),
        )
      ) ?? null;
  const matchedPolicies: [] = [];
  const resolvedCapabilities = [
    ...new Set([
      ...existingCapabilities,
      ...matchingGrantOverrideCapabilities({
        overrides: deploymentGrantOverrides,
        identity: requestedIdentity,
      }),
    ]),
  ].sort();
  const resolvedApproval = effectiveApproval({
    storedApproval,
    matchedPolicies: [],
  });
  const unresolvedCapabilities = missingCapabilities({
    requiredCapabilities: approvalCapabilityKeys(plan.approval),
    effectiveCapabilities: resolvedCapabilities,
  });

  return {
    plan,
    trellisId,
    userOrigin: pending.user.origin,
    userId: pending.user.id,
    userEmail,
    userName,
    sessionPublicKey: pending.sessionKey,
    app,
    existingProjection,
    existingCapabilities,
    effectiveCapabilities: resolvedCapabilities,
    missingCapabilities: unresolvedCapabilities,
    matchedPolicies,
    effectiveApproval: resolvedApproval,
    storedApproval,
    requestedBoundary,
    systemAvailabilityEnvelope: enabledDeploymentEnvelopes.length > 0
      ? systemAvailabilityEnvelope
      : EMPTY_BOUNDARY,
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
  currentConfig: Pick<Config, "oauth" | "web"> & Partial<Config>,
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
  return hostname === "localhost" || hostname === "127.0.0.1" ||
    hostname === "::1" || hostname === "[::1]";
}
