import { type AsyncResult, type BaseError, isErr } from "@qlever-llc/result";

import type { Session } from "../schemas.ts";
import type { SqlSessionRepository } from "../storage.ts";
import {
  connectionFilterForSession,
  parseConnectionKey,
} from "./connections.ts";

type SessionStore = Pick<
  SqlSessionRepository,
  "deleteBySessionKey" | "getOneBySessionKey"
>;

type ConnectionsStore = {
  keys: (
    filter: string,
  ) => AsyncResult<AsyncIterable<string> | unknown, BaseError>;
  get: (key: string) => AsyncResult<unknown, BaseError>;
  delete: (key: string) => AsyncResult<unknown, BaseError>;
};

type RuntimeConnection = { serverId: string; clientId: number };

function isAsyncStringIterable(value: unknown): value is AsyncIterable<string> {
  return !!value && typeof value === "object" &&
    Symbol.asyncIterator in value;
}

function unwrapConnection(entry: unknown): RuntimeConnection | null {
  const value = entry && typeof entry === "object" && "value" in entry
    ? entry.value
    : entry;
  if (!value || typeof value !== "object") return null;
  const serverId = "serverId" in value ? value.serverId : undefined;
  const clientId = "clientId" in value ? value.clientId : undefined;
  if (typeof serverId !== "string" || typeof clientId !== "number") {
    return null;
  }
  return { serverId, clientId };
}

/** Terminates a session and any selected live NATS connection records. */
export async function terminateSession(args: {
  sessionKey: string;
  scopeId?: string;
  sessionStorage: SessionStore;
  connectionsKV: ConnectionsStore;
  kick: (serverId: string, clientId: number) => Promise<void>;
}): Promise<Session | null> {
  const session =
    await args.sessionStorage.getOneBySessionKey(args.sessionKey) ??
      null;

  await args.sessionStorage.deleteBySessionKey(args.sessionKey);

  const connectionKeys = await args.connectionsKV.keys(
    connectionFilterForSession(args.sessionKey),
  ).take();
  if (isErr(connectionKeys) || !isAsyncStringIterable(connectionKeys)) {
    return session;
  }

  for await (const key of connectionKeys) {
    const parsedKey = parseConnectionKey(key);
    if (!parsedKey) continue;
    if (args.scopeId !== undefined && parsedKey.scopeId !== args.scopeId) {
      continue;
    }

    const entry = await args.connectionsKV.get(key).take();
    if (!isErr(entry)) {
      const connection = unwrapConnection(entry);
      if (connection) {
        try {
          await args.kick(connection.serverId, connection.clientId);
        } catch {
          // Session termination must still remove durable connection records.
        }
      }
    }
    await args.connectionsKV.delete(key).take();
  }

  return session;
}
