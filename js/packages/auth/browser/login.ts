import { Value } from "typebox/value";
import {
  type BindResponse,
  BindResponseSchema,
  type BindSuccessResponse,
  type SentinelCreds,
} from "../schemas.ts";
import type { SessionKeyHandle } from "./session.ts";
import { bindSig, getPublicSessionKey, oauthInitSig } from "./session.ts";

export type {
  BindResponse,
  BindSuccessResponse,
  ContractApproval,
  SentinelCreds,
} from "../schemas.ts";

export type AuthConfig = {
  authUrl: string;
};

function encodeContractForQuery(contract: Record<string, unknown>): string {
  const json = JSON.stringify(contract);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function buildLoginUrl(
  config: AuthConfig,
  provider: string,
  redirectTo: string,
  handle: SessionKeyHandle,
  contract: Record<string, unknown>,
): Promise<string> {
  const sessionKey = getPublicSessionKey(handle);
  const sig = await oauthInitSig(handle, redirectTo);

  const url = new URL(`${config.authUrl}/auth/login/${provider}`);
  url.searchParams.set("redirectTo", redirectTo);
  url.searchParams.set("sessionKey", sessionKey);
  url.searchParams.set("sig", sig);
  url.searchParams.set("contract", encodeContractForQuery(contract));

  return url.href;
}

export function extractAuthTokenFromFragment(
  url: string = window.location.href,
): string | null {
  const parsed = new URL(url);
  const fragment = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  const params = new URLSearchParams(fragment);
  return params.get("authToken");
}

export function extractAuthErrorFromFragment(
  url: string = window.location.href,
): string | null {
  const parsed = new URL(url);
  const fragment = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  const params = new URLSearchParams(fragment);
  return params.get("authError");
}

export function isBindSuccessResponse(response: BindResponse): response is BindSuccessResponse {
  return response.status === "bound";
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
