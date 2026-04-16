import { Value } from "typebox/value";
import {
  type AuthStartRequest,
  type AuthStartResponse,
  AuthStartRequestSchema,
  AuthStartResponseSchema,
  type BindResponse,
  BindResponseSchema,
  type BindSuccessResponse,
  type SentinelCreds,
} from "../schemas.ts";
import type { SessionKeyHandle } from "./session.ts";
import { bindFlowSig, bindSig, getPublicSessionKey, oauthInitSig } from "./session.ts";

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
    : buildLoginUrlArgsFromPositional(argsOrConfig, provider, redirectTo, handle, contract, context);
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
  const sig = await oauthInitSig(args.handle, args.redirectTo, args.context);
  const request = Value.Parse(AuthStartRequestSchema, {
    redirectTo: args.redirectTo,
    sessionKey: getPublicSessionKey(args.handle),
    sig,
    contract: args.contract,
    ...(args.provider ? { provider: args.provider } : {}),
    ...(contextRecord(args.context) ? { context: contextRecord(args.context) } : {}),
  }) as AuthStartRequest;

  const response = await fetch(`${args.authUrl}/auth/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Auth request failed: ${response.status} ${text}`);
  }

  return Value.Parse(AuthStartResponseSchema, await response.json()) as AuthStartResponse;
}

function buildLoginUrlArgsFromPositional(
  config: AuthConfig,
  provider: string | undefined,
  redirectTo: string | undefined,
  handle: SessionKeyHandle | undefined,
  contract: Record<string, unknown> | undefined,
  context: unknown,
): BuildLoginUrlArgs {
  if (redirectTo === undefined || handle === undefined || contract === undefined) {
    throw new TypeError("buildLoginUrl requires redirectTo, handle, and contract");
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

function isNestedBuildLoginUrlArgs(
  value: BuildLoginUrlArgs | BuildLoginUrlFlatArgs | AuthConfig,
): value is BuildLoginUrlArgs {
  return "config" in value;
}

function isFlatBuildLoginUrlArgs(
  value: BuildLoginUrlArgs | BuildLoginUrlFlatArgs | AuthConfig,
): value is BuildLoginUrlFlatArgs {
  return "authUrl" in value && "redirectTo" in value && "handle" in value && "contract" in value;
}

export function isBindSuccessResponse(response: BindResponse): response is BindSuccessResponse {
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

  return Value.Parse(BindResponseSchema, await response.json()) as BindResponse;
}

export async function bindSession(
  config: AuthConfig,
  handle: SessionKeyHandle,
  authToken: string,
): Promise<BindResponse> {
  const sessionKey = getPublicSessionKey(handle);
  const sig = await bindSig(handle, authToken);

  const response = await fetch(`${config.authUrl}/auth/bind`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authToken,
      sessionKey,
      sig,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bind failed: ${response.status} ${text}`);
  }

  return Value.Parse(BindResponseSchema, await response.json()) as BindResponse;
}
