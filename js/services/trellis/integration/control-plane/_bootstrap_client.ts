import { assert } from "@std/assert";
import { TrellisClient } from "@qlever-llc/trellis";
import {
  base64urlEncode,
  createAuth,
  sha256,
  utf8,
} from "@qlever-llc/trellis/auth.ts";
import type { LiveTrellisRuntime } from "../_support/runtime.ts";

type ControlPlaneSqlite = NonNullable<
  LiveTrellisRuntime["controlPlane"]
>["sqlite"];
type ClientContract = Parameters<LiveTrellisRuntime["registerClient"]>[0][
  "contract"
];

/** Returns the live control-plane SQLite helper required by bootstrap branch tests. */
export function requireControlPlaneSqlite(
  runtime: LiveTrellisRuntime,
): ControlPlaneSqlite {
  const sqlite = runtime.controlPlane?.sqlite;
  assert(sqlite, "live runtime must expose control-plane SQLite");
  return sqlite;
}

/** Creates a live bound app session and closes its NATS connection. */
export async function createBoundClientSession(
  runtime: LiveTrellisRuntime,
  args: { name: string; contract: ClientContract },
): Promise<{ seed: string; sessionKey: string }> {
  const clientKey = await runtime.registerClient(args);
  const clientAuth = runtime.clientAuth(clientKey);
  const client = await TrellisClient.connect({
    trellisUrl: runtime.trellisUrl,
    name: args.name,
    contract: args.contract,
    auth: clientAuth.auth,
    onAuthRequired: clientAuth.onAuthRequired,
  }).orThrow();
  await client.connection.close();
  return clientKey;
}

/** Fetches `/bootstrap/client` with a session-key proof. */
export async function fetchClientBootstrap(
  trellisUrl: string,
  seed: string,
  args?: { iat?: number; sig?: string },
): Promise<Response> {
  const auth = await createAuth({ sessionKeySeed: seed });
  const iat = args?.iat ?? auth.currentIat();
  const sig = args?.sig ?? await signClientBootstrapProof(seed, iat);
  return await fetch(new URL("/bootstrap/client", trellisUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionKey: auth.sessionKey, iat, sig }),
  });
}

/** Signs a client bootstrap proof for direct HTTP route coverage. */
export async function signClientBootstrapProof(
  seed: string,
  iat: number,
): Promise<string> {
  const auth = await createAuth({ sessionKeySeed: seed });
  return base64urlEncode(
    await auth.sign(await sha256(utf8(`bootstrap-client:${iat}`))),
  );
}

/** Returns whether a session row still exists. */
export async function sessionExists(
  sqlite: ControlPlaneSqlite,
  sessionKey: string,
): Promise<boolean> {
  const rows = await sqlite.query(
    "SELECT 1 FROM sessions WHERE session_key = ?",
    [
      sessionKey,
    ],
  );
  return rows.length > 0;
}

/** Marks the user projection backing a session inactive. */
export async function markSessionUserInactive(
  sqlite: ControlPlaneSqlite,
  sessionKey: string,
): Promise<void> {
  await sqlite.execute("UPDATE users SET active = 0 WHERE user_id = ?", [
    await sessionUserId(sqlite, sessionKey),
  ]);
}

/** Deletes the user projection backing a session. */
export async function deleteSessionUserProjection(
  sqlite: ControlPlaneSqlite,
  sessionKey: string,
): Promise<void> {
  await sqlite.execute("DELETE FROM users WHERE user_id = ?", [
    await sessionUserId(sqlite, sessionKey),
  ]);
}

/** Removes all current capabilities from the user projection backing a session. */
export async function clearSessionUserCapabilities(
  sqlite: ControlPlaneSqlite,
  sessionKey: string,
): Promise<void> {
  const session = await readStoredSession(sqlite, sessionKey);
  assert(
    Array.isArray(session.delegatedCapabilities) &&
      session.delegatedCapabilities.length > 0,
    "test session must have delegated capabilities before clearing the user",
  );
  await sqlite.execute(
    "UPDATE users SET capabilities = ?, capability_groups = ? WHERE user_id = ?",
    [
      JSON.stringify([]),
      JSON.stringify([]),
      await sessionUserId(sqlite, sessionKey),
    ],
  );
}

/** Rewrites the stored contract fields for an existing session row. */
export async function rewriteSessionContract(
  sqlite: ControlPlaneSqlite,
  sessionKey: string,
  contract: {
    digest: string;
    id: string;
    displayName: string;
    description: string;
  },
): Promise<void> {
  const session = await readStoredSession(sqlite, sessionKey);
  session.contractDigest = contract.digest;
  session.contractId = contract.id;
  session.contractDisplayName = contract.displayName;
  session.contractDescription = contract.description;
  await sqlite.execute(
    "UPDATE sessions SET contract_digest = ?, contract_id = ?, session = ? WHERE session_key = ?",
    [contract.digest, contract.id, JSON.stringify(session), sessionKey],
  );
}

async function sessionUserId(
  sqlite: ControlPlaneSqlite,
  sessionKey: string,
): Promise<string> {
  const rows = await sqlite.query(
    "SELECT trellis_id AS trellisId FROM sessions WHERE session_key = ?",
    [sessionKey],
  );
  const userId = rows[0]?.trellisId;
  assert(typeof userId === "string" && userId.length > 0);
  return userId;
}

async function readStoredSession(
  sqlite: ControlPlaneSqlite,
  sessionKey: string,
): Promise<Record<string, unknown>> {
  const rows = await sqlite.query(
    "SELECT session FROM sessions WHERE session_key = ?",
    [sessionKey],
  );
  const sessionText = rows[0]?.session;
  assert(typeof sessionText === "string" && sessionText.length > 0);
  const session = JSON.parse(sessionText);
  assert(
    session !== null && typeof session === "object" && !Array.isArray(session),
  );
  return session;
}
