import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";
import { isErr, Result } from "@qlever-llc/result";
import { AuthError } from "@qlever-llc/trellis";

import type { Session } from "../../state/schemas.ts";

type UserRefFilter = { user?: string };
type SessionFilter = { sessionKey?: string; user?: string };

type SessionListRow = {
  key: string;
  sessionKey: string;
  participantKind: "app" | "agent" | "device" | "service";
  principal:
    | { type: "user"; trellisId: string; origin: string; id: string; name: string }
    | { type: "service"; id: string; name: string; instanceId: string; profileId: string }
    | { type: "device"; deviceId: string; deviceType: string; runtimePublicKey: string; profileId: string };
  contractId?: string;
  contractDisplayName?: string;
  appOrigin?: string;
  createdAt: string;
  lastAuth: string;
};

type ConnectionRow = {
  key: string;
  userNkey: string;
  sessionKey: string;
  participantKind: SessionListRow["participantKind"];
  principal: SessionListRow["principal"];
  contractId?: string;
  contractDisplayName?: string;
  appOrigin?: string;
  serverId: string;
  clientId: number;
  connectedAt: string;
};

type TakeLike<T = unknown> = { take(): T | Promise<T> };

type SessionStore = {
  keys: (filter: string) => TakeLike | Promise<TakeLike>;
  get: (key: string) => TakeLike | Promise<TakeLike>;
};

type ConnectionStore = {
  keys: (filter: string) => TakeLike | Promise<TakeLike>;
  get: (key: string) => TakeLike | Promise<TakeLike>;
};

async function takeValue<T>(value: TakeLike<T> | Promise<TakeLike<T>>): Promise<T> {
  const taken = await value;
  return await taken.take();
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseOriginId(value: string): { origin: string; id: string } | null {
  const idx = value.indexOf(".");
  if (idx <= 0 || idx >= value.length - 1) return null;
  return { origin: value.slice(0, idx), id: value.slice(idx + 1) };
}

function deviceTypeFromProfileId(profileId: string): string {
  const [deviceType] = profileId.split(".", 1);
  return deviceType && deviceType.length > 0 ? deviceType : profileId;
}

function sessionActorKey(session: Session, sessionKey: string, userNkey?: string): string {
  const actor = session.type === "device"
    ? `${session.instanceId}.${session.publicIdentityKey}`
    : `${session.origin}.${session.id}`;
  return userNkey ? `${actor}.${sessionKey}.${userNkey}` : `${actor}.${sessionKey}`;
}

function buildSessionRow(session: Session, sessionKey: string): SessionListRow {
  if (session.type === "user") {
    return {
      key: sessionActorKey(session, sessionKey),
      sessionKey,
      participantKind: session.participantKind,
      principal: {
        type: "user",
        trellisId: session.trellisId,
        origin: session.origin,
        id: session.id,
        name: session.name,
      },
      contractId: session.contractId,
      contractDisplayName: session.contractDisplayName,
      ...(session.app?.origin ? { appOrigin: session.app.origin } : {}),
      createdAt: iso(session.createdAt),
      lastAuth: iso(session.lastAuth),
    };
  }

  if (session.type === "device") {
    return {
      key: sessionActorKey(session, sessionKey),
      sessionKey,
      participantKind: "device",
      principal: {
        type: "device",
        deviceId: session.instanceId,
        deviceType: deviceTypeFromProfileId(session.profileId),
        runtimePublicKey: session.publicIdentityKey,
        profileId: session.profileId,
      },
      contractId: session.contractId,
      createdAt: iso(session.createdAt),
      lastAuth: iso(session.lastAuth),
    };
  }

  return {
    key: sessionActorKey(session, sessionKey),
    sessionKey,
    participantKind: "service",
    principal: {
      type: "service",
      id: session.id,
      name: session.name,
      instanceId: session.instanceId,
      profileId: session.profileId,
    },
    createdAt: iso(session.createdAt),
    lastAuth: iso(session.lastAuth),
  };
}

function buildConnectionRow(
  session: Session,
  sessionKey: string,
  userNkey: string,
  connection: { serverId: string; clientId: number; connectedAt: string | Date },
): ConnectionRow {
  const sessionRow = buildSessionRow(session, sessionKey);
  return {
    key: sessionActorKey(session, sessionKey, userNkey),
    userNkey,
    sessionKey,
    participantKind: sessionRow.participantKind,
    principal: sessionRow.principal,
    ...(sessionRow.contractId ? { contractId: sessionRow.contractId } : {}),
    ...(sessionRow.contractDisplayName ? { contractDisplayName: sessionRow.contractDisplayName } : {}),
    ...(sessionRow.appOrigin ? { appOrigin: sessionRow.appOrigin } : {}),
    serverId: connection.serverId,
    clientId: connection.clientId,
    connectedAt: iso(connection.connectedAt),
  };
}

export function createAuthListSessionsHandler(deps: { sessionKV: SessionStore }) {
  return async (req: UserRefFilter = {}) => {
    const userFilter = typeof req.user === "string" ? req.user : undefined;
    let filter = ">";
    if (userFilter) {
      const parsed = parseOriginId(userFilter);
      if (!parsed) return Result.err(new AuthError({ reason: "invalid_request" }));
      const trellisId = await trellisIdFromOriginId(parsed.origin, parsed.id);
      filter = `>.${trellisId}`;
    }

    const iter = await takeValue(deps.sessionKV.keys(filter));
    if (isErr(iter)) return Result.ok({ sessions: [] });

    const sessions: SessionListRow[] = [];
    for await (const key of iter as AsyncIterable<string>) {
      const entry = await takeValue(deps.sessionKV.get(key));
      if (isErr(entry)) continue;
      const sessionKey = key.split(".")[0] ?? "";
      sessions.push(buildSessionRow((entry as { value: Session }).value, sessionKey));
    }

    sessions.sort((left, right) => left.key.localeCompare(right.key));
    return Result.ok({ sessions });
  };
}

export function createAuthListConnectionsHandler(deps: {
  sessionKV: Pick<SessionStore, "get">;
  connectionsKV: ConnectionStore;
}) {
  return async (req: SessionFilter = {}) => {
    const userFilter = typeof req.user === "string" ? req.user : undefined;
    const sessionKeyFilter = typeof req.sessionKey === "string" ? req.sessionKey : undefined;

    let filter = ">";
    if (sessionKeyFilter) {
      filter = `${sessionKeyFilter}.>.>`;
    } else if (userFilter) {
      const parsed = parseOriginId(userFilter);
      if (!parsed) return Result.err(new AuthError({ reason: "invalid_request" }));
      const trellisId = await trellisIdFromOriginId(parsed.origin, parsed.id);
      filter = `>.${trellisId}.>`;
    }

    const iter = await takeValue(deps.connectionsKV.keys(filter));
    if (isErr(iter)) return Result.ok({ connections: [] });

    const connections: ConnectionRow[] = [];
    for await (const key of iter as AsyncIterable<string>) {
      const entry = await takeValue(deps.connectionsKV.get(key));
      if (isErr(entry)) continue;

      const parts = key.split(".");
      const sessionKey = parts[0];
      const trellisId = parts[1];
      const userNkey = parts[2];
      if (!sessionKey || !trellisId || !userNkey) continue;

      const session = await takeValue(deps.sessionKV.get(`${sessionKey}.${trellisId}`));
      if (isErr(session)) continue;

      connections.push(buildConnectionRow(
        (session as { value: Session }).value,
        sessionKey,
        userNkey,
        (entry as { value: { serverId: string; clientId: number; connectedAt: string | Date } }).value,
      ));
    }

    connections.sort((left, right) => left.key.localeCompare(right.key));
    return Result.ok({ connections });
  };
}
