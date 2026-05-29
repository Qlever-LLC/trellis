import { HTTPException } from "@hono/hono/http-exception";
import { approvalCapabilityKeys } from "@qlever-llc/trellis/auth";

import {
  type AuthorityNeedSet,
  type PendingAuth,
  type SessionApprovalSource,
  type SessionIdentity,
} from "../schemas.ts";
import {
  type AuthorityIdentityAnchor,
  computeAuthorityNeedsDelta,
  evaluateProposalNeedsFit,
} from "../authority_needs_decision.ts";
import {
  type ApprovalResolution,
  buildAppIdentity,
  getApprovalResolutionBlocker,
} from "./support.ts";

export type AuthStartRequest = {
  provider?: string;
  redirectTo: string;
  sessionKey: string;
  sig: string;
  contractDigest?: string;
  contract?: Record<string, unknown>;
  context?: Record<string, unknown>;
};

export type AuthStartBoundResponse = {
  status: "bound";
  inboxPrefix: string;
  expires: string;
  sentinel: { jwt: string; seed: string };
  transports: {
    native?: { natsServers: string[] };
    websocket?: { natsServers: string[] };
  };
};

export type AuthStartFlowResponse = {
  status: "flow_started";
  flowId: string;
  loginUrl: string;
};

export type AuthStartResponse = AuthStartBoundResponse | AuthStartFlowResponse;

export type CurrentUserSession = {
  userId: string;
  identity: SessionIdentity;
  origin: string;
  id: string;
  email: string;
  name: string;
  image?: string;
  contractId: string;
  app?: PendingAuth["app"];
  delegatedCapabilities: string[];
  delegatedPublishSubjects: string[];
  delegatedSubscribeSubjects: string[];
  identityAuthorityNeeds?: AuthorityNeedSet;
  approvalSource?: SessionApprovalSource;
  identityAnchor?: AuthorityIdentityAnchor;
  sessionPublicKey?: string;
};

export type UserFacingApprovalResolution =
  | {
    status: "approved";
    source: "existing_identity_grant" | "user_decision" | "deployment_grant";
  }
  | { status: "approval_required"; delta: AuthorityNeedSet }
  | { status: "insufficient_capabilities"; missingCapabilities: string[] }
  | { status: "unavailable"; missingAvailability: AuthorityNeedSet };

const EMPTY_AUTHORITY_NEEDS: AuthorityNeedSet = {
  contracts: [],
  surfaces: [],
  capabilities: [],
  resources: [],
};

function canonicalizeJsonValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("JSON numbers must be finite");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJsonValue).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${
      keys.map((key) =>
        `${JSON.stringify(key)}:${
          canonicalizeJsonValue((value as Record<string, unknown>)[key])
        }`
      ).join(",")
    }}`;
  }

  throw new Error("Value is not JSON-serializable");
}

export function buildAuthStartSignaturePayload(args: AuthStartRequest): string {
  const contractPresentation = args.contract ?? args.contractDigest;
  return `${args.redirectTo}:${args.provider ?? ""}:${
    canonicalizeJsonValue(contractPresentation)
  }:${canonicalizeJsonValue(args.context ?? null)}`;
}

function isSubset(requested: string[], current: string[]): boolean {
  const currentSet = new Set(current);
  return requested.every((value) => currentSet.has(value));
}

function boundaryFromApprovalPlan(
  resolution: ApprovalResolution,
): AuthorityNeedSet {
  return {
    contracts: [],
    surfaces: [],
    capabilities: approvalCapabilityKeys(resolution.plan.approval),
    resources: [],
  };
}

function sameIdentityAnchor(
  left: AuthorityIdentityAnchor,
  right: AuthorityIdentityAnchor,
): boolean {
  if (left.contractId !== right.contractId) {
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

function currentSessionIdentityAnchor(
  session: CurrentUserSession,
): AuthorityIdentityAnchor {
  if (session.identityAnchor) return session.identityAnchor;
  const sessionContractId = session.app?.contractId ?? session.contractId;
  const sessionOrigin = session.app?.origin;
  if (sessionOrigin) {
    return {
      kind: "web",
      contractId: sessionContractId,
      origin: sessionOrigin,
    };
  }
  return {
    kind: "cli",
    contractId: sessionContractId,
    sessionPublicKey: session.sessionPublicKey ?? session.contractId,
  };
}

function requestedIdentityAnchor(args: {
  sessionKey: string;
  resolution: ApprovalResolution;
}): AuthorityIdentityAnchor {
  if (args.resolution.app?.origin) {
    return {
      kind: "web",
      contractId: args.resolution.app.contractId,
      origin: args.resolution.app.origin,
    };
  }
  return {
    kind: "cli",
    contractId: args.resolution.app?.contractId ??
      args.resolution.plan.contract.id,
    sessionPublicKey: args.sessionKey,
  };
}

export function resolveCurrentSessionApproval(
  args: {
    requestedIdentity: AuthorityIdentityAnchor;
    resolution: ApprovalResolution;
    systemAvailabilityAuthority?: AuthorityNeedSet;
  } & CurrentUserSession,
): UserFacingApprovalResolution {
  if (args.resolution.missingCapabilities.length > 0) {
    return {
      status: "insufficient_capabilities",
      missingCapabilities: args.resolution.missingCapabilities,
    };
  }

  const requestedAuthority = args.resolution.requestedAuthority ??
    boundaryFromApprovalPlan(args.resolution);
  const requestedAvailabilityAuthority = {
    ...requestedAuthority,
    capabilities: [],
  };
  const systemAvailabilityAuthority = args.systemAvailabilityAuthority ??
    args.resolution.systemAvailabilityAuthority;
  const systemAvailabilityFit = systemAvailabilityAuthority
    ? evaluateProposalNeedsFit(
      systemAvailabilityAuthority,
      requestedAvailabilityAuthority,
    )
    : {
      fits: true,
      missingAvailability: EMPTY_AUTHORITY_NEEDS,
      missingCapabilities: [],
    };
  if (!systemAvailabilityFit.fits) {
    return {
      status: "unavailable",
      missingAvailability: systemAvailabilityFit.missingAvailability,
    };
  }

  const existingIdentity = currentSessionIdentityAnchor(args);
  if (!sameIdentityAnchor(existingIdentity, args.requestedIdentity)) {
    return { status: "approval_required", delta: EMPTY_AUTHORITY_NEEDS };
  }

  if (!args.identityAuthorityNeeds) {
    return { status: "approval_required", delta: requestedAuthority };
  }

  const delta = computeAuthorityNeedsDelta(
    args.identityAuthorityNeeds,
    requestedAuthority,
  );
  if (
    delta.contracts.length > 0 || delta.surfaces.length > 0 ||
    delta.capabilities.length > 0 || delta.resources.length > 0
  ) {
    return { status: "approval_required", delta };
  }

  if (
    !isSubset(
      args.resolution.plan.publishSubjects,
      args.delegatedPublishSubjects,
    )
  ) {
    return { status: "approval_required", delta: EMPTY_AUTHORITY_NEEDS };
  }
  if (
    !isSubset(
      args.resolution.plan.subscribeSubjects,
      args.delegatedSubscribeSubjects,
    )
  ) {
    return { status: "approval_required", delta: EMPTY_AUTHORITY_NEEDS };
  }

  return { status: "approved", source: "existing_identity_grant" };
}

export function createAuthStartRequestHandler(deps: {
  verifyInitRequest: (req: AuthStartRequest) => Promise<boolean>;
  loadCurrentUserSession: (
    sessionKey: string,
  ) => Promise<CurrentUserSession | null>;
  getApprovalResolution: (pending: PendingAuth) => Promise<ApprovalResolution>;
  planContract: (
    contract: Record<string, unknown>,
  ) => Promise<ApprovalResolution["plan"]>;
  resolveContract?: (req: AuthStartRequest) => Promise<Record<string, unknown>>;
  bindApprovedSession: (args: {
    pendingValue: PendingAuth;
    resolution: ApprovalResolution;
    approvalSource: SessionApprovalSource;
  }) => Promise<AuthStartBoundResponse>;
  createFlow: (args: {
    authUrl: string;
    provider?: string;
    sessionKey: string;
    redirectTo: string;
    contract: Record<string, unknown>;
    context?: Record<string, unknown>;
    plan: ApprovalResolution["plan"];
  }) => Promise<AuthStartFlowResponse>;
}) {
  return async (
    req: AuthStartRequest,
    opts: { authUrl: string },
  ): Promise<AuthStartResponse> => {
    if (!(await deps.verifyInitRequest(req))) {
      throw new HTTPException(400, { message: "Invalid signature" });
    }
    const contract = req.contract ?? await deps.resolveContract?.(req);
    if (!contract) {
      throw new HTTPException(409, { message: "manifest_required" });
    }

    const existingSession = await deps.loadCurrentUserSession(req.sessionKey);
    let resolution: ApprovalResolution | null = null;
    if (existingSession) {
      const pendingValue: PendingAuth = {
        userId: existingSession.userId,
        identity: existingSession.identity,
        user: {
          origin: existingSession.origin,
          id: existingSession.id,
          email: existingSession.email,
          name: existingSession.name,
          ...(existingSession.image ? { image: existingSession.image } : {}),
        },
        sessionKey: req.sessionKey,
        redirectTo: req.redirectTo,
        ...(typeof contract.id === "string"
          ? {
            app: buildAppIdentity({
              contractId: contract.id,
              redirectTo: req.redirectTo,
            }),
          }
          : {}),
        contract,
        createdAt: new Date(),
      };
      resolution = await deps.getApprovalResolution(pendingValue);

      const currentSessionApproval = resolveCurrentSessionApproval({
        ...existingSession,
        requestedIdentity: requestedIdentityAnchor({
          sessionKey: req.sessionKey,
          resolution,
        }),
        resolution,
      });
      const approvalReady = getApprovalResolutionBlocker(resolution) === null &&
        currentSessionApproval.status === "approved";

      if (approvalReady) {
        return await deps.bindApprovedSession({
          pendingValue,
          resolution,
          approvalSource: currentSessionApproval.source === "user_decision"
            ? "stored_approval"
            : existingSession.approvalSource ?? "stored_approval",
        });
      }
    }

    const plan = resolution?.plan ?? await deps.planContract(contract);
    return deps.createFlow({
      authUrl: opts.authUrl,
      provider: req.provider,
      sessionKey: req.sessionKey,
      redirectTo: req.redirectTo,
      contract,
      ...(req.context ? { context: req.context } : {}),
      plan,
    });
  };
}
