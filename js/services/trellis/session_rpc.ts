import { base64urlDecode, trellisIdFromOriginId, verifyProof } from "@qlever-llc/trellis-auth";
import { AsyncResult, isErr, Result } from "@qlever-llc/trellis-result";
import { AuthError } from "@qlever-llc/trellis-trellis";

import { getConfig } from "./config.ts";
import {
  bindingTokenKV,
  connectionsKV,
  logger,
  natsAuth,
  sentinelCreds,
  servicesKV,
  sessionKV,
  trellis,
  usersKV,
} from "./globals.ts";
import { resolveSessionPrincipal } from "./session_principal.ts";

const config = getConfig();

type SessionUser = {
  id: string;
  origin: string;
  email: string;
  name: string;
  active: boolean;
  capabilities: string[];
  image?: string;
  lastLogin?: string;
};

type SessionContext = {
  user: SessionUser;
  sessionKey: string;
};

type ValidateRequestInput = {
  sessionKey: string;
  subject: string;
  payloadHash: string;
  proof: string;
  capabilities?: string[];
};

type UserRefFilter = { user?: string };
type SessionFilter = { sessionKey?: string; user?: string };
type SessionKeyRequest = { sessionKey: string };
type UserNkeyRequest = { userNkey: string };
type SessionListRow = {
  key: string;
  type: "user" | "service";
  createdAt: string;
  lastAuth: string;
};
type ConnectionRow = {
  key: string;
  serverId: string;
  clientId: number;
  connectedAt: string;
};

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseOriginId(value: string): { origin: string; id: string } | null {
  const idx = value.indexOf(".");
  if (idx <= 0 || idx >= value.length - 1) return null;
  return { origin: value.slice(0, idx), id: value.slice(idx + 1) };
}

export async function registerSessionRpcHandlers(opts: {
  randomToken: (bytes: number) => string;
  hashKey: (value: string) => Promise<string>;
  kick: (serverId: string, clientId: number) => Promise<void>;
}): Promise<void> {
  await trellis.mount("Auth.Me", async (_req: unknown, { user, sessionKey }: SessionContext) => {
    logger.trace({ rpc: "Auth.Me", sessionKey, userId: user.id }, "RPC request");
    const trellisId = await trellisIdFromOriginId(user.origin, user.id);
    const projection = (await usersKV.get(trellisId)).take();
    if (!isErr(projection)) {
      user = { ...user, capabilities: projection.value.capabilities ?? [] };
    }
    return Result.ok({ user });
  });

  await trellis.mount("Auth.ValidateRequest", async (req: ValidateRequestInput) => {
    logger.trace({ rpc: "Auth.ValidateRequest", sessionKey: req.sessionKey, subject: req.subject }, "RPC request");

    const payloadHashBytes = base64urlDecode(req.payloadHash);
    const proofOk = await verifyProof(
      req.sessionKey,
      {
        sessionKey: req.sessionKey,
        subject: req.subject,
        payloadHash: payloadHashBytes,
      },
      req.proof,
    );
    if (!proofOk) {
      return Result.err(new AuthError({ reason: "invalid_signature" }));
    }

    const keysIter = (await sessionKV.keys(`${req.sessionKey}.>`)).take();
    if (isErr(keysIter)) {
      return Result.err(new AuthError({ reason: "session_not_found" }));
    }

    let sessionKeyId: string | undefined;
    for await (const key of keysIter) {
      if (!sessionKeyId) sessionKeyId = key;
      else {
        return Result.err(new AuthError({
          reason: "session_corrupted",
          context: { sessionKey: req.sessionKey },
        }));
      }
    }

    if (!sessionKeyId) return Result.err(new AuthError({ reason: "session_not_found" }));
    const sessionEntry = (await sessionKV.get(sessionKeyId)).take();
    if (isErr(sessionEntry)) return Result.err(new AuthError({ reason: "session_not_found" }));

    const session = sessionEntry.value;
    const inboxPrefix = `_INBOX.${req.sessionKey.slice(0, 16)}`;
    const principal = await resolveSessionPrincipal(session, req.sessionKey, {
      servicesKV,
      usersKV,
    });
    if (!principal.ok) {
      return Result.err(new AuthError(principal.error));
    }

    const required = req.capabilities ?? [];
    const allowed = required.length === 0 ||
      required.every((capability) => principal.value.capabilities.includes(capability));

    return Result.ok({
      allowed,
      inboxPrefix,
      user: {
        id: session.id,
        origin: session.origin,
        email: principal.value.email,
        name: principal.value.name,
        capabilities: principal.value.capabilities,
        active: principal.value.active,
        ...(session.image ? { image: session.image } : {}),
      },
    });
  });

  await trellis.mount("Auth.Logout", async (_req: unknown, { user, sessionKey }: SessionContext) => {
    logger.trace({ rpc: "Auth.Logout", sessionKey, userId: user.id }, "RPC request");
    const trellisId = await trellisIdFromOriginId(user.origin, user.id);
    const sessionKeyId = `${sessionKey}.${trellisId}`;

    await sessionKV.delete(sessionKeyId);

    const connKeys = (await connectionsKV.keys(`${sessionKey}.${trellisId}.>`)).take();
    if (!isErr(connKeys)) {
      for await (const key of connKeys) {
        const entry = (await connectionsKV.get(key)).take();
        if (!isErr(entry)) {
          await AsyncResult.try(() =>
            natsAuth.request(
              `$SYS.REQ.SERVER.${entry.value.serverId}.KICK`,
              JSON.stringify({ cid: entry.value.clientId }),
            )
          );
        }
        await connectionsKV.delete(key);
      }
    }

    return Result.ok({ success: true });
  });

  await trellis.mount("Auth.RenewBindingToken", async (_req: unknown, { user, sessionKey }: SessionContext) => {
    logger.trace({ rpc: "Auth.RenewBindingToken", sessionKey, userId: user.id }, "RPC request");
    const trellisId = await trellisIdFromOriginId(user.origin, user.id);
    const sessionKeyId = `${sessionKey}.${trellisId}`;

    const session = (await sessionKV.get(sessionKeyId)).take();
    if (isErr(session)) {
      return Result.err(new AuthError({ reason: "session_not_found", context: { sessionKey } }));
    }

    const bindingToken = opts.randomToken(32);
    const bindingTokenHash = await opts.hashKey(bindingToken);
    const now = new Date();
    const expires = new Date(now.getTime() + config.ttlMs.bindingTokens.renew);
    await bindingTokenKV.put(bindingTokenHash, {
      sessionKey,
      kind: "renew",
      createdAt: now,
      expiresAt: expires,
    });

    return Result.ok({
      status: "bound",
      bindingToken,
      inboxPrefix: `_INBOX.${sessionKey.slice(0, 16)}`,
      expires: expires.toISOString(),
      sentinel: sentinelCreds,
    });
  });

  await trellis.mount("Auth.ListSessions", async (req: UserRefFilter) => {
    logger.trace({ rpc: "Auth.ListSessions", user: req.user }, "RPC request");
    const userFilter = typeof req.user === "string" ? req.user : undefined;
    let filter = ">";
    if (userFilter) {
      const parsed = parseOriginId(userFilter);
      if (!parsed) {
        return Result.err(new AuthError({ reason: "invalid_request" }));
      }
      const trellisId = await trellisIdFromOriginId(parsed.origin, parsed.id);
      filter = `>.${trellisId}`;
    }

    const iter = (await sessionKV.keys(filter)).take();
    if (isErr(iter)) {
      return Result.ok({ sessions: [] });
    }

    const sessions: SessionListRow[] = [];
    for await (const key of iter) {
      const entry = (await sessionKV.get(key)).take();
      if (isErr(entry)) continue;

      const sessionKey = key.split(".")[0] ?? "";
      sessions.push({
        key: `${entry.value.origin}.${entry.value.id}.${sessionKey}`,
        type: entry.value.type,
        createdAt: iso(entry.value.createdAt),
        lastAuth: iso(entry.value.lastAuth),
      });
    }

    return Result.ok({ sessions });
  });

  await trellis.mount("Auth.RevokeSession", async (req: SessionKeyRequest, { user }: { user: SessionUser }) => {
    logger.trace({ rpc: "Auth.RevokeSession", targetSessionKey: req.sessionKey, userId: user.id }, "RPC request");
    if (typeof req.sessionKey !== "string" || req.sessionKey.length === 0) {
      return Result.err(new AuthError({ reason: "invalid_request" }));
    }

    const sessionIter = (await sessionKV.keys(`${req.sessionKey}.>`)).take();
    if (isErr(sessionIter)) {
      return Result.ok({ success: false });
    }

    const sessionsToDelete: string[] = [];
    for await (const key of sessionIter) sessionsToDelete.push(key);
    if (sessionsToDelete.length === 0) return Result.ok({ success: false });

    const kickedBy = `${user.origin}.${user.id}`;
    const connIter = (await connectionsKV.keys(`${req.sessionKey}.>.>`)).take();
    if (!isErr(connIter)) {
      for await (const key of connIter) {
        const entry = (await connectionsKV.get(key)).take();
        if (!isErr(entry)) {
          await opts.kick(entry.value.serverId, entry.value.clientId);
        }
        await connectionsKV.delete(key);
      }
    }

    for (const sessionKeyId of sessionsToDelete) {
      const entry = (await sessionKV.get(sessionKeyId)).take();
      if (!isErr(entry)) {
        (
          await trellis.publish("Auth.SessionRevoked", {
            origin: entry.value.origin,
            id: entry.value.id,
            sessionKey: req.sessionKey,
            revokedBy: kickedBy,
          })
        ).inspectErr((error) =>
          logger.warn({ error }, "Failed to publish Auth.SessionRevoked")
        );
      }
      await sessionKV.delete(sessionKeyId);
    }

    return Result.ok({ success: true });
  });

  await trellis.mount("Auth.ListConnections", async (req: SessionFilter) => {
    logger.trace({ rpc: "Auth.ListConnections", user: req.user, sessionKey: req.sessionKey }, "RPC request");
    const userFilter = typeof req.user === "string" ? req.user : undefined;
    const sessionKeyFilter = typeof req.sessionKey === "string" ? req.sessionKey : undefined;

    let filter = ">";
    if (sessionKeyFilter) {
      filter = `${sessionKeyFilter}.>.>`;
    } else if (userFilter) {
      const parsed = parseOriginId(userFilter);
      if (!parsed) {
        return Result.err(new AuthError({ reason: "invalid_request" }));
      }
      const trellisId = await trellisIdFromOriginId(parsed.origin, parsed.id);
      filter = `>.${trellisId}.>`;
    }

    const iter = (await connectionsKV.keys(filter)).take();
    if (isErr(iter)) {
      return Result.ok({ connections: [] });
    }

    const connections: ConnectionRow[] = [];
    for await (const key of iter) {
      const entry = (await connectionsKV.get(key)).take();
      if (isErr(entry)) continue;

      const parts = key.split(".");
      const sessionKey = parts[0];
      const trellisId = parts[1];
      const userNkey = parts[2];
      if (!sessionKey || !trellisId || !userNkey) continue;

      const session = (await sessionKV.get(`${sessionKey}.${trellisId}`)).take();
      if (isErr(session)) continue;

      connections.push({
        key: `${session.value.origin}.${session.value.id}.${sessionKey}.${userNkey}`,
        serverId: entry.value.serverId,
        clientId: entry.value.clientId,
        connectedAt: iso(entry.value.connectedAt),
      });
    }

    return Result.ok({ connections });
  });

  await trellis.mount("Auth.KickConnection", async (req: UserNkeyRequest, { user }: { user: SessionUser }) => {
    logger.trace({ rpc: "Auth.KickConnection", userNkey: req.userNkey, userId: user.id }, "RPC request");
    if (typeof req.userNkey !== "string" || req.userNkey.length === 0) {
      return Result.err(new AuthError({ reason: "invalid_request" }));
    }

    const iter = (await connectionsKV.keys(`>.>.${req.userNkey}`)).take();
    if (isErr(iter)) {
      return Result.ok({ success: false });
    }

    const kickedBy = `${user.origin}.${user.id}`;
    let kicked = false;

    for await (const key of iter) {
      const entry = (await connectionsKV.get(key)).take();
      if (!isErr(entry)) {
        await opts.kick(entry.value.serverId, entry.value.clientId);
      }

      const parts = key.split(".");
      const sessionKey = parts[0];
      const trellisId = parts[1];
      if (sessionKey && trellisId) {
        const session = (await sessionKV.get(`${sessionKey}.${trellisId}`)).take();
        if (!isErr(session)) {
          (
            await trellis.publish("Auth.ConnectionKicked", {
              origin: session.value.origin,
              id: session.value.id,
              userNkey: req.userNkey,
              kickedBy,
            })
          ).inspectErr((error) =>
            logger.warn({ error }, "Failed to publish Auth.ConnectionKicked")
          );
        }
      }

      await connectionsKV.delete(key);
      kicked = true;
    }

    return Result.ok({ success: kicked });
  });
}
