export type ParticipantKind = "app" | "agent" | "device" | "service";

type UserPrincipal = {
  type: "user";
  trellisId: string;
  origin: string;
  id: string;
  name?: string;
};

type DevicePrincipal = {
  type: "device";
  deviceId: string;
  deviceType: string;
  runtimePublicKey: string;
  profileId: string;
};

type ServicePrincipal = {
  type: "service";
  id: string;
  name: string;
  instanceId: string;
  profileId: string;
};

type SharedRecord = {
  participantKind: ParticipantKind;
  principal: UserPrincipal | DevicePrincipal | ServicePrincipal;
  contractDisplayName?: string;
  contractId?: string;
  appOrigin?: string;
};

export type SessionRecord = SharedRecord & {
  key: string;
  sessionKey: string;
  createdAt: string;
  lastAuth: string;
};

export type ConnectionRecord = SharedRecord & {
  key: string;
  sessionKey: string;
  userNkey: string;
  serverId: string;
  clientId: number;
  connectedAt: string;
};

export type UserGrantRecord = {
  contractDigest: string;
  contractId: string;
  displayName: string;
  description: string;
  participantKind: "app" | "agent";
  capabilities: string[];
  grantedAt: string;
  updatedAt: string;
};

type SessionLike = SessionRecord | ConnectionRecord;

export function formatOriginId(origin: string, id: string): string {
  return `${origin}.${id}`;
}

export function formatShortKey(value: string | null | undefined, size = 12): string {
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
      return "badge-ghost";
  }

  const exhaustive: never = kind;
  return exhaustive;
}

function contractLabel(record: { contractDisplayName?: string; contractId?: string }): string | null {
  if (record.contractDisplayName && record.contractId) {
    return `${record.contractDisplayName} (${record.contractId})`;
  }
  return record.contractDisplayName ?? record.contractId ?? null;
}

function joinDetails(details: Array<string | null | undefined>): string {
  return details.filter((detail): detail is string => Boolean(detail && detail.length > 0)).join(" • ");
}

export function describeSessionPrincipal(record: SessionLike): { title: string; details: string } {
  const contract = contractLabel(record);
  const principal = record.principal;

  if (principal.type === "user") {
    const handle = formatOriginId(principal.origin, principal.id);
    return {
      title: principal.name?.trim() || handle,
      details: joinDetails([
        principal.name?.trim() ? handle : null,
        record.appOrigin ? `origin ${record.appOrigin}` : null,
        contract,
      ]),
    };
  }

  if (principal.type === "device") {
    return {
      title: principal.deviceId,
      details: joinDetails([
        principal.deviceType,
        principal.profileId,
        contract,
      ]),
    };
  }

  return {
    title: principal.name,
    details: joinDetails([
      principal.id,
      principal.profileId,
      principal.instanceId,
    ]),
  };
}

export function describeUserGrant(grant: UserGrantRecord): { title: string; details: string } {
  return {
    title: grant.displayName || grant.contractId,
    details: joinDetails([
      `${participantKindLabel(grant.participantKind)} grant`,
      grant.contractId,
    ]),
  };
}
