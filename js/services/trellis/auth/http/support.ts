import { trellisIdFromOriginId } from "@qlever-llc/trellis-auth";
import { isErr } from "@qlever-llc/trellis-result";

import { planUserContractApproval } from "../approval/plan.ts";
import type { Config } from "../../config.ts";
import type { ContractStore } from "../../catalog/store.ts";
import { contractApprovalsKV, logger, usersKV } from "../../bootstrap/globals.ts";
import type {
  ContractApprovalRecord,
  OAuthState,
  PendingAuth,
} from "../../state/schemas.ts";

export type OAuthStateEntry = {
  value: OAuthState;
  delete: (cas?: boolean) => Promise<unknown>;
};

export type PendingAuthEntry = {
  value: PendingAuth;
  delete: (cas?: boolean) => Promise<unknown>;
};

export type ApprovalResolution = {
  plan: Awaited<ReturnType<typeof planUserContractApproval>>;
  trellisId: string;
  userEmail: string;
  userName: string;
  existingCapabilities: string[];
  missingCapabilities: string[];
  storedApproval: ContractApprovalRecord | null;
};

export type CookieContext = {
  req: { header: (name: string) => string | undefined };
  header: (name: string, value: string) => void;
  json: (body: unknown, status?: number) => Response;
  redirect: (location: string) => Response;
};

const LOCAL_COOKIE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function contractApprovalKey(userTrellisId: string, contractDigest: string): string {
  return `${userTrellisId}.${contractDigest}`;
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

export function buildFragmentRedirect(target: string, values: Record<string, string>): string {
  const url = new URL(target);
  const fragment = new URLSearchParams(values);
  url.hash = fragment.toString();
  return url.toString();
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
): Promise<ApprovalResolution> {
  const plan = await planUserContractApproval(contractStore, pending.contract);
  const trellisId = await trellisIdFromOriginId(pending.user.origin, pending.user.id);
  const userEmail = pending.user.email ?? `${pending.user.origin}:${pending.user.id}`;
  const userName = pending.user.name ?? pending.user.id;
  const existingProjection = (await usersKV.get(trellisId)).take();
  const existingCapabilities = isErr(existingProjection) ? [] : existingProjection.value.capabilities;
  const missingCapabilities = plan.approval.capabilities.filter((capability: string) => !existingCapabilities.includes(capability));
  const approvalEntry = (await contractApprovalsKV.get(contractApprovalKey(trellisId, plan.digest))).take();
  const storedApproval = isErr(approvalEntry) ? null : approvalEntry.value;

  return {
    plan,
    trellisId,
    userEmail,
    userName,
    existingCapabilities,
    missingCapabilities,
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
    return decodeURIComponent(part.slice(eq + 1));
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

export function shouldUseSecureOauthCookie(currentConfig: Config): boolean {
  const origin = currentConfig.web.publicOrigin ?? currentConfig.oauth.redirectBase;
  try {
    const url = new URL(origin);
    if (url.protocol === "https:") return true;
    if (url.protocol === "http:" && LOCAL_COOKIE_HOSTS.has(url.hostname)) {
      return false;
    }
  } catch {
    logger.warn({ origin }, "Failed to parse auth public origin for cookie policy");
  }
  return true;
}
