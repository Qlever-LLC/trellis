import { HTTPException } from "@hono/hono/http-exception";

import type {
  PendingAuth,
  SessionApprovalSource,
} from "../../state/schemas.ts";
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
  contract: Record<string, unknown>;
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
  origin: string;
  id: string;
  email: string;
  name: string;
  image?: string;
  contractId: string;
  app?: PendingAuth["app"];
  appOrigin?: string;
  delegatedCapabilities: string[];
  delegatedPublishSubjects: string[];
  delegatedSubscribeSubjects: string[];
  approvalSource?: SessionApprovalSource;
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
  return `${args.redirectTo}:${args.provider ?? ""}:${
    canonicalizeJsonValue(args.contract)
  }:${canonicalizeJsonValue(args.context ?? null)}`;
}

function isSubset(requested: string[], current: string[]): boolean {
  const currentSet = new Set(current);
  return requested.every((value) => currentSet.has(value));
}

function sameAppIdentity(
  session: CurrentUserSession,
  resolution: ApprovalResolution,
): boolean {
  const sessionContractId = session.app?.contractId ?? session.contractId;
  const sessionOrigin = session.app?.origin ?? session.appOrigin;
  return sessionContractId === resolution.app?.contractId &&
    sessionOrigin === resolution.app?.origin;
}

export function canAutoApproveFromCurrentSession(
  session: CurrentUserSession,
  resolution: ApprovalResolution,
): boolean {
  if (session.contractId !== resolution.plan.contract.id) {
    return false;
  }
  if (!sameAppIdentity(session, resolution)) {
    return false;
  }
  if (
    !isSubset(
      resolution.plan.approval.capabilities,
      session.delegatedCapabilities,
    )
  ) {
    return false;
  }
  if (
    !isSubset(resolution.plan.publishSubjects, session.delegatedPublishSubjects)
  ) {
    return false;
  }
  return isSubset(
    resolution.plan.subscribeSubjects,
    session.delegatedSubscribeSubjects,
  );
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
  bindApprovedSession: (args: {
    pendingValue: PendingAuth;
    resolution: ApprovalResolution;
    tokenKind: "renew";
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

    const existingSession = await deps.loadCurrentUserSession(req.sessionKey);
    let resolution: ApprovalResolution | null = null;
    if (existingSession) {
      const pendingValue: PendingAuth = {
        user: {
          origin: existingSession.origin,
          id: existingSession.id,
          email: existingSession.email,
          name: existingSession.name,
          ...(existingSession.image ? { image: existingSession.image } : {}),
        },
        sessionKey: req.sessionKey,
        redirectTo: req.redirectTo,
        ...(typeof req.contract.id === "string"
          ? {
            app: buildAppIdentity({
              contractId: req.contract.id,
              redirectTo: req.redirectTo,
            }),
          }
          : {}),
        contract: req.contract,
        createdAt: new Date(),
      };
      resolution = await deps.getApprovalResolution(pendingValue);

      const approvalReady = getApprovalResolutionBlocker(resolution) === null &&
        resolution.missingCapabilities.length === 0 &&
        (
          resolution.effectiveApproval.answer === "approved" ||
          canAutoApproveFromCurrentSession(existingSession, resolution)
        );

      if (approvalReady) {
        return await deps.bindApprovedSession({
          pendingValue,
          resolution,
          tokenKind: "renew",
          approvalSource: resolution.effectiveApproval.answer === "approved"
            ? resolution.effectiveApproval.kind
            : existingSession.approvalSource ?? "stored_approval",
        });
      }
    }

    const plan = resolution?.plan ?? await deps.planContract(req.contract);
    return deps.createFlow({
      authUrl: opts.authUrl,
      provider: req.provider,
      sessionKey: req.sessionKey,
      redirectTo: req.redirectTo,
      contract: req.contract,
      ...(req.context ? { context: req.context } : {}),
      plan,
    });
  };
}
