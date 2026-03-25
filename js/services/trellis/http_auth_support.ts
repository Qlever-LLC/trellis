import { trellisIdFromOriginId } from "@trellis/auth";
import { isErr } from "@trellis/result";

import { planUserContractApproval } from "./app_approval.ts";
import type { Config } from "./config.ts";
import type { ContractStore } from "./contracts_store.ts";
import { contractApprovalsKV, logger, usersKV } from "./globals.ts";
import type {
  ContractApprovalRecord,
  OAuthState,
  PendingAuth,
} from "./schemas.ts";

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

export function renderApprovalPage(args: {
  authToken: string;
  redirectTo: string;
  status: "approval_required" | "approval_denied" | "insufficient_capabilities";
  approval: ApprovalResolution["plan"]["approval"];
  missingCapabilities?: string[];
  userCapabilities?: string[];
}): string {
  const capabilities = args.approval.capabilities.map((capability: string) => `<li>${escapeHtml(capability)}</li>`).join("");
  const missing = (args.missingCapabilities ?? []).map((capability) => `<li>${escapeHtml(capability)}</li>`).join("");
  const current = (args.userCapabilities ?? []).map((capability) => `<li>${escapeHtml(capability)}</li>`).join("");
  const title = args.status === "approval_denied"
    ? "App access was previously denied"
    : args.status === "insufficient_capabilities"
    ? "Your account is missing required capabilities"
    : "Approve app access";
  const copy = args.status === "approval_denied"
    ? "You previously denied this app's delegation request. You can keep it denied or approve it now."
    : args.status === "insufficient_capabilities"
    ? "This app cannot act on your behalf until your account has all of the requested capabilities."
    : "Review the app contract and approve the exact capabilities it wants to exercise on your behalf.";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} · Trellis Auth</title>
    <style>
      :root { color-scheme: light; --bg:#f3efe5; --panel:#fffdf8; --ink:#1d1d1b; --muted:#655f55; --line:#d9d0c1; --accent:#0f766e; --danger:#b42318; }
      * { box-sizing:border-box; } body { margin:0; font-family: ui-sans-serif, system-ui, sans-serif; background: radial-gradient(circle at top, #fff7e8, var(--bg)); color:var(--ink); }
      main { max-width: 760px; margin: 48px auto; padding: 0 20px; }
      .card { background:var(--panel); border:1px solid var(--line); border-radius:24px; box-shadow:0 18px 60px rgba(0,0,0,0.08); overflow:hidden; }
      .content { padding:32px; display:grid; gap:24px; } .eyebrow { font-size:12px; text-transform:uppercase; letter-spacing:.22em; color:var(--accent); }
      h1,h2,p,ul { margin:0; } p { line-height:1.6; color:var(--muted); } .grid { display:grid; gap:16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
      .panel { border:1px solid var(--line); border-radius:18px; padding:18px; background:#fff; } code { font-family: ui-monospace, monospace; font-size:12px; word-break:break-all; }
      ul { padding-left: 20px; display:grid; gap:6px; } .actions { display:flex; gap:12px; flex-wrap:wrap; } button, a { border-radius:999px; padding:12px 18px; font:inherit; text-decoration:none; border:1px solid transparent; cursor:pointer; }
      button.approve { background:var(--accent); color:white; } button.deny { background:white; color:var(--ink); border-color:var(--line); } a.back { color:var(--muted); border-color:var(--line); }
      .danger { color:var(--danger); } @media (max-width: 640px) { .content { padding:24px; } .actions { flex-direction:column; } button, a { width:100%; text-align:center; } }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <div class="content">
          <div>
            <div class="eyebrow">Trellis Auth</div>
            <h1>${escapeHtml(title)}</h1>
            <p>${escapeHtml(copy)}</p>
          </div>
          <div class="grid">
            <div class="panel"><strong>${escapeHtml(args.approval.displayName)}</strong><p>${escapeHtml(args.approval.description)}</p></div>
            <div class="panel"><strong>Kind</strong><p>${escapeHtml(args.approval.kind)}</p><strong>Contract digest</strong><p><code>${escapeHtml(args.approval.contractDigest)}</code></p></div>
          </div>
          <div class="panel"><strong>Requested capabilities</strong><ul>${capabilities || "<li>None</li>"}</ul></div>
          ${args.status === "insufficient_capabilities" ? `<div class="grid"><div class="panel"><strong class="danger">Missing capabilities</strong><ul>${missing}</ul></div><div class="panel"><strong>Your current capabilities</strong><ul>${current || "<li>None</li>"}</ul></div></div>` : ""}
          <div class="actions">
            ${args.status === "insufficient_capabilities" ? "" : `<form method="post" action="/auth/approve"><input type="hidden" name="authToken" value="${escapeHtml(args.authToken)}" /><input type="hidden" name="decision" value="approved" /><button class="approve" type="submit">Approve and continue</button></form><form method="post" action="/auth/approve"><input type="hidden" name="authToken" value="${escapeHtml(args.authToken)}" /><input type="hidden" name="decision" value="denied" /><button class="deny" type="submit">Deny access</button></form>`}
            <a class="back" href="${escapeHtml(args.redirectTo)}">Return to app</a>
          </div>
        </div>
      </section>
    </main>
  </body>
</html>`;
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
  const origin = currentConfig.web.publicOrigin ?? currentConfig.oauth.redirect;
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
