import { decodeTrellisHttpError } from "../http_error.ts";
import { type PortalFlowState, PortalFlowStateSchema } from "../protocol.ts";
import type { StaticDecode } from "typebox";
import { Type } from "typebox";
import { Value } from "typebox/value";

export type { PortalFlowState } from "../protocol.ts";
export type ApprovalDecision = "approved" | "denied";
export type AuthConfig = {
  authUrl: string;
  /** Explicit portal origin for non-browser automation; browsers supply Origin. */
  portalOrigin?: string;
};
export type PortalBinding = { secret: string; digest: string };

const PORTAL_BINDING_HEADER = "trellis-portal-binding";
const PORTAL_BINDING_KEY_PREFIX = "trellis.portal-binding.v1:";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

function decodeBase64Url(value: string): Uint8Array | null {
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Returns the portal browser's per-flow verifier, creating it when absent. */
export async function createPortalBinding(): Promise<PortalBinding> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return {
    secret: base64Url(bytes),
    digest: base64Url(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
      ),
    ),
  };
}

/** Returns the portal browser's per-flow verifier, creating it when absent. */
export async function getOrCreatePortalBinding(
  flowId: string,
  storage: Storage,
): Promise<PortalBinding> {
  const key = `${PORTAL_BINDING_KEY_PREFIX}${flowId}`;
  const stored = storage.getItem(key);
  const storedBytes = stored ? decodeBase64Url(stored) : null;
  const created = storedBytes?.length === 32
    ? null
    : await createPortalBinding();
  const bytes = storedBytes ?? decodeBase64Url(created!.secret)!;
  const secret = created?.secret ?? stored!;
  if (secret !== stored) storage.setItem(key, secret);
  return {
    secret,
    digest: base64Url(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
      ),
    ),
  };
}

function authBaseUrl(config: AuthConfig): string {
  return config.authUrl.replace(/\/$/, "");
}

const BrowserFlowWireProperties = {
  flowId: Type.String({ minLength: 1 }),
  expiresAt: Type.Integer(),
  state: Type.Union([
    Type.Literal("choose_provider"),
    Type.Literal("authenticated"),
    Type.Literal("approval_required"),
    Type.Literal("approval_denied"),
    Type.Literal("approved"),
    Type.Literal("consumed"),
    Type.Literal("expired"),
  ]),
  providers: Type.Array(Type.String({ minLength: 1 })),
  registrationEnabled: Type.Boolean(),
  federatedRegistrationEnabled: Type.Boolean(),
  consentView: Type.Object({
    participant: Type.Object({
      id: Type.String({ minLength: 1 }),
      digest: Type.String({ minLength: 1 }),
      displayName: Type.String({ minLength: 1 }),
      description: Type.String(),
    }),
    required: Type.Object({
      permissions: Type.Array(Type.Unknown()),
      capabilities: Type.Array(Type.String({ minLength: 1 })),
    }),
    optionalBundles: Type.Optional(Type.Array(Type.Object({
      id: Type.String({ minLength: 1 }),
      apiId: Type.String({ minLength: 1 }),
      permissions: Type.Array(Type.Record(Type.String(), Type.Unknown())),
    }))),
  }),
  redirectTarget: Type.Optional(Type.Union([
    Type.Null(),
    Type.String({ minLength: 1 }),
  ])),
};
const BrowserFlowWireSchema = Type.Object(BrowserFlowWireProperties);
const PortalFlowWireSchema = Type.Object({
  ...BrowserFlowWireProperties,
  consentViewDigest: Type.String({ minLength: 1 }),
  user: Type.Object({
    origin: Type.String({ minLength: 1 }),
    id: Type.String({ minLength: 1 }),
    name: Type.Optional(Type.String({ minLength: 1 })),
    email: Type.Optional(Type.String({ minLength: 1 })),
    image: Type.Optional(Type.String({ minLength: 1 })),
  }),
});
type BrowserFlowWire = StaticDecode<typeof BrowserFlowWireSchema>;
type PortalFlowWire = StaticDecode<typeof PortalFlowWireSchema>;

function approval(wire: BrowserFlowWire) {
  const capabilities: Record<
    string,
    { displayName: string; description: string }
  > = {};
  for (const name of wire.consentView.required.capabilities) {
    capabilities[`capability:${name}`] = {
      displayName: name,
      description: "Required by this application.",
    };
  }
  wire.consentView.required.permissions.forEach((permission, index) => {
    capabilities[`permission:${index}`] = {
      displayName: "Required permission",
      description: JSON.stringify(permission),
    };
  });
  return {
    contractId: wire.consentView.participant.id,
    contractDigest: wire.consentView.participant.digest,
    displayName: wire.consentView.participant.displayName,
    description: wire.consentView.participant.description,
    capabilities,
  };
}

function portalState(wire: BrowserFlowWire | PortalFlowWire): PortalFlowState {
  const evidence = approval(wire);
  let state: unknown;
  if (wire.state === "choose_provider") {
    const federatedProviders = wire.providers.filter((id) => id !== "local")
      .map(
        (id) => ({ id, displayName: id }),
      );
    state = {
      status: "choose_provider",
      flowId: wire.flowId,
      providers: wire.providers.map((id) => ({ id, displayName: id })),
      app: {
        contractId: evidence.contractId,
        contractDigest: evidence.contractDigest,
        displayName: evidence.displayName,
        description: evidence.description,
      },
      registration: {
        localIdentity: { available: wire.registrationEnabled },
        federatedIdentity: {
          available: wire.federatedRegistrationEnabled,
          providers: federatedProviders,
        },
      },
    };
  } else if (wire.state === "authenticated") {
    state = { status: "processing", flowId: wire.flowId };
  } else if (wire.state === "approval_required") {
    if (!("user" in wire) || !("consentViewDigest" in wire)) {
      throw new Error("Authenticated portal flow requires portal binding");
    }
    state = {
      status: "approval_required",
      flowId: wire.flowId,
      consentViewDigest: wire.consentViewDigest,
      optionalBundles: (wire.consentView.optionalBundles ?? []).map((
        bundle,
      ) => ({
        id: bundle.id,
        apiId: bundle.apiId,
        permissions: bundle.permissions,
      })),
      user: wire.user,
      approval: evidence,
    };
  } else if (wire.state === "approval_denied") {
    state = {
      status: "approval_denied",
      flowId: wire.flowId,
      approval: evidence,
      ...(wire.redirectTarget ? { returnLocation: wire.redirectTarget } : {}),
    };
  } else if (wire.state === "approved" || wire.state === "consumed") {
    if (!wire.redirectTarget) {
      throw new Error("Completed portal flow has no redirect target");
    }
    const location = new URL(wire.redirectTarget);
    location.searchParams.set("flowId", wire.flowId);
    state = { status: "redirect", location: location.toString() };
  } else if (wire.state === "expired") {
    state = {
      status: "expired",
      ...(wire.redirectTarget ? { returnLocation: wire.redirectTarget } : {}),
    };
  }
  return Value.Parse(PortalFlowStateSchema, state) as PortalFlowState;
}

async function fetchBrowserFlowWire(
  config: AuthConfig,
  flowId: string,
): Promise<BrowserFlowWire> {
  const response = await fetch(
    `${authBaseUrl(config)}/auth/flow/${encodeURIComponent(flowId)}`,
  );
  if (!response.ok) {
    throw await decodeTrellisHttpError(response);
  }
  return Value.Parse(BrowserFlowWireSchema, await response.json());
}

export function portalFlowIdFromUrl(url: URL): string | null {
  return url.searchParams.get("flowId");
}

export async function fetchPortalFlowState(
  config: AuthConfig,
  flowId: string,
  binding: PortalBinding,
): Promise<PortalFlowState> {
  const flow = await fetchBrowserFlowWire(config, flowId);
  if (flow.state !== "authenticated" && flow.state !== "approval_required") {
    return portalState(flow);
  }
  const response = await fetch(
    `${authBaseUrl(config)}/auth/flow/${encodeURIComponent(flowId)}/portal`,
    {
      method: "POST",
      headers: {
        ...(config.portalOrigin ? { origin: config.portalOrigin } : {}),
        [PORTAL_BINDING_HEADER]: binding.secret,
      },
    },
  );
  if (!response.ok) {
    throw await decodeTrellisHttpError(response);
  }
  return portalState(Value.Parse(PortalFlowWireSchema, await response.json()));
}

export function portalProviderLoginUrl(
  config: AuthConfig,
  providerId: string,
  flowId: string,
  binding: PortalBinding,
): string {
  const base = `${authBaseUrl(config)}/auth/login/${
    encodeURIComponent(providerId)
  }`;
  const query = new URLSearchParams({
    flowId,
    portalBindingDigest: binding.digest,
  });
  return `${base}?${query}`;
}

export async function submitPortalApproval(
  config: AuthConfig,
  flowId: string,
  binding: PortalBinding,
  decision: ApprovalDecision,
  selectedOptionalBundles: readonly string[] = [],
): Promise<PortalFlowState> {
  const flow = await fetchPortalFlowState(config, flowId, binding);
  if (flow.status !== "approval_required") {
    throw new Error("Portal flow is not awaiting approval");
  }
  const response = await fetch(
    `${authBaseUrl(config)}/auth/flow/${encodeURIComponent(flowId)}/approval`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.portalOrigin ? { origin: config.portalOrigin } : {}),
        [PORTAL_BINDING_HEADER]: binding.secret,
      },
      body: JSON.stringify({
        approved: decision === "approved",
        consentViewDigest: flow.consentViewDigest,
        selectedOptionalBundles,
      }),
    },
  );

  if (!response.ok) {
    throw await decodeTrellisHttpError(response);
  }

  return portalState(Value.Parse(PortalFlowWireSchema, await response.json()));
}

export function portalRedirectLocation(
  state: PortalFlowState | null,
): string | null {
  if (state?.status === "redirect") return state.location;
  if (state?.status === "approval_denied") return state.returnLocation ?? null;
  if (state?.status === "expired") return state.returnLocation ?? null;
  return null;
}
