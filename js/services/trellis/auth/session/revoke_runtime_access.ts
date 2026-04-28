import {
  type AsyncResult,
  type BaseError,
  isErr,
  Result,
} from "@qlever-llc/result";

import { connectionFilterForSession } from "./connections.ts";

type RuntimeConnectionKV = {
  keys: (
    filter: string,
  ) => AsyncResult<AsyncIterable<string> | unknown, BaseError>;
  get: (key: string) => AsyncResult<unknown, BaseError>;
  delete: (key: string) => AsyncResult<unknown, BaseError>;
};

type RuntimeConnection = { serverId: string; clientId: number };

async function takeValue<T>(
  value: AsyncResult<T, BaseError>,
): Promise<T | Result<never, BaseError>> {
  return await value.take();
}

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

/**
 * Kicks all live connections selected by a session filter, deletes their
 * connection records, then deletes the owning session record.
 */
export async function revokeRuntimeAccessForSession(args: {
  sessionKey: string;
  connectionsKV: RuntimeConnectionKV;
  kick: (serverId: string, clientId: number) => Promise<void>;
  deleteSession: () => Promise<void>;
  connectionFilter?: string;
  shouldRevokeConnectionKey?: (key: string) => boolean;
}): Promise<void> {
  const connectionKeys = await takeValue(
    args.connectionsKV.keys(
      args.connectionFilter ?? connectionFilterForSession(args.sessionKey),
    ),
  );
  if (!isErr(connectionKeys) && isAsyncStringIterable(connectionKeys)) {
    for await (const key of connectionKeys) {
      if (args.shouldRevokeConnectionKey?.(key) === false) continue;

      const entry = await takeValue(args.connectionsKV.get(key));
      if (!isErr(entry)) {
        const connection = unwrapConnection(entry);
        if (connection) {
          await args.kick(connection.serverId, connection.clientId);
        }
      }
      await takeValue(args.connectionsKV.delete(key));
    }
  }

  await args.deleteSession();
}
