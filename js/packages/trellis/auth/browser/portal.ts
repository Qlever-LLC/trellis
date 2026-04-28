import { type PortalFlowState, PortalFlowStateSchema } from "../protocol.ts";
import type { ApprovalDecision } from "../schemas.ts";
import type { AuthConfig } from "./login.ts";
import { Value } from "typebox/value";

export type { PortalFlowState } from "../protocol.ts";
export type { ApprovalDecision } from "../schemas.ts";

function authBaseUrl(config: AuthConfig): string {
  return config.authUrl.replace(/\/$/, "");
}

export function portalFlowIdFromUrl(url: URL): string | null {
  return url.searchParams.get("flowId");
}

export async function fetchPortalFlowState(
  config: AuthConfig,
  flowId: string,
): Promise<PortalFlowState> {
  const response = await fetch(
    `${authBaseUrl(config)}/auth/flow/${encodeURIComponent(flowId)}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to load portal flow (${response.status})`);
  }

  return Value.Parse(
    PortalFlowStateSchema,
    await response.json(),
  ) as PortalFlowState;
}

export function portalProviderLoginUrl(
  config: AuthConfig,
  providerId: string,
  flowId: string,
): string {
  const base = `${authBaseUrl(config)}/auth/login/${
    encodeURIComponent(providerId)
  }`;
  return `${base}?flowId=${encodeURIComponent(flowId)}`;
}

export async function submitPortalApproval(
  config: AuthConfig,
  flowId: string,
  decision: ApprovalDecision,
): Promise<PortalFlowState> {
  const response = await fetch(
    `${authBaseUrl(config)}/auth/flow/${encodeURIComponent(flowId)}/approval`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: decision === "approved" }),
    },
  );

  if (!response.ok) {
    throw new Error(`Approval request failed (${response.status})`);
  }

  return Value.Parse(
    PortalFlowStateSchema,
    await response.json(),
  ) as PortalFlowState;
}

export function portalRedirectLocation(
  state: PortalFlowState | null,
): string | null {
  return state?.status === "redirect" ? state.location : null;
}
