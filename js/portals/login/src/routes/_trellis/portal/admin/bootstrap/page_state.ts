import {
  accountFlowProviderLoginUrl,
  type AccountFlowState,
  type ActiveAccountFlowState,
  hasLocalProvider,
  loadAccountFlowState,
  parseAccountFlowOAuthCompletion,
  unavailableProviders,
} from "../../account_flow_state.ts";

/** Form values accepted by the local-password admin bootstrap endpoint. */
export type AdminBootstrapInput = {
  username: string;
  password: string;
  name: string;
  email: string;
};

/** Successful admin bootstrap completion response. */
export type AdminBootstrapSuccess = {
  status: "created";
  userId: string;
};

/** Backend error details used for user-facing bootstrap messages. */
export type BootstrapErrorDetails = {
  status: number;
  error: string | null;
};

/** Minimal fetch-compatible function used by the completion helper. */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export {
  accountFlowProviderLoginUrl,
  hasLocalProvider,
  loadAccountFlowState,
  parseAccountFlowOAuthCompletion,
  unavailableProviders,
};
export type { AccountFlowState, ActiveAccountFlowState };

const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  flow_not_found:
    "This bootstrap request was not found. Start bootstrap again.",
  flow_expired: "This bootstrap request has expired. Start bootstrap again.",
  flow_already_consumed: "This bootstrap request has already been used.",
  admin_already_exists:
    "An admin account already exists for this Trellis instance.",
  local_identity_exists:
    "That username is already in use. Choose a different username.",
  flow_wrong_kind: "This request cannot create an admin account.",
  flow_missing_admin_capability:
    "This request is missing permission to create the first admin account.",
  flow_consume_conflict:
    "This bootstrap request was completed elsewhere. Refresh and check the admin account.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function successBody(value: unknown): AdminBootstrapSuccess | null {
  if (!isRecord(value)) return null;
  if (value.status !== "created") return null;
  if (typeof value.userId !== "string") return null;
  return { status: "created", userId: value.userId };
}

function responseErrorBody(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.error === "string" ? value.error : null;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Extract the bootstrap flow id from a portal URL. */
export function adminBootstrapFlowId(url: URL): string | null {
  const flowId = url.searchParams.get("flowId")?.trim();
  return flowId && flowId.length > 0 ? flowId : null;
}

/** Convert backend bootstrap errors into concise user-facing messages. */
export function formatAdminBootstrapError(
  details: BootstrapErrorDetails,
): string {
  if (details.error && details.error in KNOWN_ERROR_MESSAGES) {
    return KNOWN_ERROR_MESSAGES[details.error];
  }

  if (details.error) {
    return `Bootstrap failed (${details.status}): ${details.error}`;
  }

  return `Bootstrap failed with status ${details.status}.`;
}

/** Complete a local-password admin bootstrap flow against the Trellis auth endpoint. */
export async function completeAdminBootstrap(
  trellisUrl: string,
  flowId: string,
  input: AdminBootstrapInput,
  fetcher: FetchLike = fetch,
): Promise<AdminBootstrapSuccess> {
  const url = new URL(
    `/auth/account-flow/${encodeURIComponent(flowId)}/local-password`,
    trellisUrl,
  );
  const payload: Record<string, string> = {
    username: input.username,
    password: input.password,
  };

  const name = input.name.trim();
  const email = input.email.trim();
  if (name) payload.name = name;
  if (email) payload.email = email;

  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await parseJson(response);

  if (response.ok) {
    const success = successBody(body);
    if (success) return success;
    throw new Error(
      "Bootstrap completed but the server returned an unexpected response.",
    );
  }

  throw new Error(
    formatAdminBootstrapError({
      status: response.status,
      error: responseErrorBody(body),
    }),
  );
}
