import { Value } from "typebox/value";
import {
  digestContractManifest,
  type TrellisContractV1,
} from "../../contract_support/mod.ts";
import {
  type AuthStartRequest,
  AuthStartRequestSchema,
  type AuthStartResponse,
  AuthStartResponseSchema,
  type BindResponse,
  BindResponseSchema,
  type BindSuccessResponse,
  type SentinelCreds,
} from "../schemas.ts";
import type { SessionKeyHandle } from "./session.ts";
import { bindFlowSig, getPublicSessionKey, oauthInitSig } from "./session.ts";

export type {
  AuthStartFlowResponse,
  AuthStartRequest,
  AuthStartResponse,
  BindResponse,
  BindSuccessResponse,
  ContractApproval,
  SentinelCreds,
} from "../schemas.ts";

export type AuthConfig = {
  authUrl: string;
};

type BuildLoginUrlArgs = {
  config: AuthConfig;
  provider?: string;
  redirectTo: string;
  handle: SessionKeyHandle;
  contract: Record<string, unknown>;
  context?: unknown;
};

type BuildLoginUrlFlatArgs = {
  authUrl: string;
  provider?: string;
  redirectTo: string;
  handle: SessionKeyHandle;
  contract: Record<string, unknown>;
  context?: unknown;
};

function contextRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export async function buildLoginUrl(
  config: AuthConfig,
  provider: string | undefined,
  redirectTo: string,
  handle: SessionKeyHandle,
  contract: Record<string, unknown>,
  context?: unknown,
): Promise<string>;
export async function buildLoginUrl(
  args: {
    authUrl: string;
    provider?: string;
    redirectTo: string;
    handle: SessionKeyHandle;
    contract: Record<string, unknown>;
    context?: unknown;
  },
): Promise<string>;
export async function buildLoginUrl(
  args: {
    config: AuthConfig;
    provider?: string;
    redirectTo: string;
    handle: SessionKeyHandle;
    contract: Record<string, unknown>;
    context?: unknown;
  },
): Promise<string>;
export async function buildLoginUrl(
  argsOrConfig: BuildLoginUrlArgs | BuildLoginUrlFlatArgs | AuthConfig,
  provider?: string,
  redirectTo?: string,
  handle?: SessionKeyHandle,
  contract?: Record<string, unknown>,
  context?: unknown,
): Promise<string> {
  const resolved = isNestedBuildLoginUrlArgs(argsOrConfig)
    ? argsOrConfig
    : isFlatBuildLoginUrlArgs(argsOrConfig)
    ? {
      config: { authUrl: argsOrConfig.authUrl },
      provider: argsOrConfig.provider,
      redirectTo: argsOrConfig.redirectTo,
      handle: argsOrConfig.handle,
      contract: argsOrConfig.contract,
      context: argsOrConfig.context,
    }
    : buildLoginUrlArgsFromPositional(
      argsOrConfig,
      provider,
      redirectTo,
      handle,
      contract,
      context,
    );
  const response = await startAuthRequest({
    authUrl: resolved.config.authUrl,
    provider: resolved.provider,
    redirectTo: resolved.redirectTo,
    handle: resolved.handle,
    contract: resolved.contract,
    context: resolved.context,
  });
  if (response.status !== "flow_started") {
    throw new Error("Auth request completed without starting a browser flow");
  }
  return response.loginUrl;
}

export async function startAuthRequest(args: {
  authUrl: string;
  provider?: string;
  redirectTo: string;
  handle: SessionKeyHandle;
  contract: Record<string, unknown>;
  context?: unknown;
}): Promise<AuthStartResponse> {
  const context = contextRecord(args.context);
  const contractDigest = isTrellisContractV1(args.contract)
    ? digestContractManifest(args.contract)
    : undefined;
  const sig = await oauthInitSig(
    args.handle,
    args.redirectTo,
    context,
    args.provider,
    contractDigest ?? args.contract,
  );
  const request = Value.Parse(AuthStartRequestSchema, {
    redirectTo: args.redirectTo,
    sessionKey: getPublicSessionKey(args.handle),
    sig,
    ...(contractDigest ? { contractDigest } : { contract: args.contract }),
    ...(args.provider ? { provider: args.provider } : {}),
    ...(context ? { context } : {}),
  }) as AuthStartRequest;

  let response = await fetch(`${args.authUrl}/auth/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (await authStartNeedsManifest(response)) {
    const fullSig = await oauthInitSig(
      args.handle,
      args.redirectTo,
      context,
      args.provider,
      args.contract,
    );
    response = await fetch(`${args.authUrl}/auth/requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...request,
        sig: fullSig,
        contract: args.contract,
      }),
    });
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Auth request failed: ${response.status} ${text}`);
  }

  return Value.Parse(
    AuthStartResponseSchema,
    await response.json(),
  ) as AuthStartResponse;
}

async function authStartNeedsManifest(response: Response): Promise<boolean> {
  if (response.ok || response.status !== 409) return false;
  const clone = response.clone();
  let payload: unknown;
  try {
    payload = await clone.json();
  } catch {
    payload = undefined;
  }
  if (payload && typeof payload === "object") {
    const record = payload as {
      reason?: unknown;
      code?: unknown;
      error?: unknown;
      message?: unknown;
    };
    return record.reason === "manifest_required" ||
      record.code === "manifest_required" ||
      record.error === "manifest_required" ||
      record.message === "manifest_required";
  }
  return (await response.clone().text()).includes("manifest_required");
}

function buildLoginUrlArgsFromPositional(
  config: AuthConfig,
  provider: string | undefined,
  redirectTo: string | undefined,
  handle: SessionKeyHandle | undefined,
  contract: Record<string, unknown> | undefined,
  context: unknown,
): BuildLoginUrlArgs {
  if (
    redirectTo === undefined || handle === undefined || contract === undefined
  ) {
    throw new TypeError(
      "buildLoginUrl requires redirectTo, handle, and contract",
    );
  }
  return {
    config,
    provider,
    redirectTo,
    handle,
    contract,
    context,
  };
}

function isTrellisContractV1(
  contract: Record<string, unknown>,
): contract is TrellisContractV1 {
  return contract.format === "trellis.contract.v1" &&
    typeof contract.id === "string" &&
    typeof contract.displayName === "string" &&
    typeof contract.description === "string" &&
    typeof contract.kind === "string";
}

function isNestedBuildLoginUrlArgs(
  value: BuildLoginUrlArgs | BuildLoginUrlFlatArgs | AuthConfig,
): value is BuildLoginUrlArgs {
  return "config" in value;
}

function isFlatBuildLoginUrlArgs(
  value: BuildLoginUrlArgs | BuildLoginUrlFlatArgs | AuthConfig,
): value is BuildLoginUrlFlatArgs {
  return "authUrl" in value && "redirectTo" in value && "handle" in value &&
    "contract" in value;
}

export function isBindSuccessResponse(
  response: BindResponse,
): response is BindSuccessResponse {
  return response.status === "bound";
}

export async function bindFlow(
  config: AuthConfig,
  handle: SessionKeyHandle,
  flowId: string,
): Promise<BindResponse> {
  const sessionKey = getPublicSessionKey(handle);
  const sig = await bindFlowSig(handle, flowId);

  const response = await fetch(
    `${config.authUrl}/auth/flow/${encodeURIComponent(flowId)}/bind`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKey, sig }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bind failed: ${response.status} ${text}`);
  }

  const payload = await response.json();
  if (payload && typeof payload === "object" && payload.status === "expired") {
    throw new Error("Bind failed: expired");
  }

  return Value.Parse(BindResponseSchema, payload) as BindResponse;
}
