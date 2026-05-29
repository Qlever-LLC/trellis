import type {
  AuthConnectionsListOutput,
  AuthSessionsListOutput,
} from "@qlever-llc/trellis/sdk/auth";

export type ParticipantKind = "app" | "agent" | "device" | "service";

type UserPrincipal = {
  type: "user";
  userId: string;
  name: string;
  identity: {
    identityId: string;
    provider: string;
    subject: string;
  };
};

export type SessionRecord = AuthSessionsListOutput["entries"][number];

export type ConnectionRecord = AuthConnectionsListOutput["entries"][number];

export type UserGrantRecord = {
  identityGrantId: string;
  contractEvidence: {
    contractDigest: string;
    contractId: string;
  };
  displayName: string;
  description: string;
  participantKind: "app" | "agent";
  capabilities: string[];
  grantedAt: string;
  updatedAt: string;
};

type SessionLike = SessionRecord | ConnectionRecord;

export function formatIdentityProviderSubject(
  identity: UserPrincipal["identity"],
): string {
  return `${identity.provider}:${identity.subject}`;
}

export function formatIdentityProviderLabel(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  switch (normalized) {
    case "local":
      return "Password";
    case "github":
      return "GitHub";
    case "google":
      return "Google";
    case "microsoft":
    case "azuread":
    case "azure-ad":
      return "Microsoft";
    case "oidc":
      return "OIDC";
    case "saml":
      return "SAML";
    default:
      return provider.trim() || "External provider";
  }
}

export function formatShortKey(
  value: string | null | undefined,
  size = 12,
): string {
  if (!value) return "—";
  return value.length <= size ? value : `${value.slice(0, size)}…`;
}

export function participantKindLabel(kind: ParticipantKind): string {
  switch (kind) {
    case "app":
      return "App";
    case "agent":
      return "Agent";
    case "device":
      return "Device";
    case "service":
      return "Service";
  }

  const exhaustive: never = kind;
  return exhaustive;
}

export function participantKindBadgeClass(kind: ParticipantKind): string {
  switch (kind) {
    case "app":
      return "badge-primary";
    case "agent":
      return "badge-secondary";
    case "device":
      return "badge-accent";
    case "service":
      return "badge-outline";
  }

  const exhaustive: never = kind;
  return exhaustive;
}

function contractLabel(record: SessionLike): string | null {
  const displayName = "contractDisplayName" in record
    ? record.contractDisplayName
    : undefined;
  const contractId = "contractId" in record ? record.contractId : undefined;

  if (displayName && contractId) {
    return `${displayName} (${contractId})`;
  }
  return displayName ?? contractId ?? null;
}

function joinDetails(details: Array<string | null | undefined>): string {
  return details.filter((detail): detail is string =>
    Boolean(detail && detail.length > 0)
  ).join(" • ");
}

export function describeSessionPrincipal(
  record: SessionLike,
): { title: string; details: string } {
  const contract = contractLabel(record);
  const principal = record.principal;

  if (principal.type === "user") {
    const identity = formatIdentityProviderSubject(principal.identity);
    return {
      title: principal.userId,
      details: joinDetails([
        principal.name.trim() || null,
        identity,
        principal.identity.identityId,
        contract,
      ]),
    };
  }

  if (principal.type === "device") {
    return {
      title: principal.deviceId,
      details: joinDetails([
        principal.deviceType,
        principal.deploymentId,
        contract,
      ]),
    };
  }

  return {
    title: principal.name,
    details: joinDetails([
      principal.id,
      principal.deploymentId,
      principal.instanceId,
    ]),
  };
}

export function describeUserGrant(
  grant: UserGrantRecord,
): { title: string; details: string } {
  return {
    title: grant.displayName || grant.contractEvidence.contractId,
    details: joinDetails([
      `${participantKindLabel(grant.participantKind)} grant`,
      grant.contractEvidence.contractId,
    ]),
  };
}
