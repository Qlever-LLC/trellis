import { assert, assertEquals } from "@std/assert";
import { defineAppContract, TrellisClient } from "@qlever-llc/trellis";
import {
  base64urlEncode,
  createAuth,
  sha256,
  utf8,
} from "@qlever-llc/trellis/auth.ts";
import {
  caseScopedContractId,
  caseScopedName,
} from "@qlever-llc/trellis-test/integration";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import type { LiveTrellisRuntime } from "../_support/runtime.ts";

const CASE_ID = "control-plane.bootstrap-rejects-unknown-contract-digest";
const clientName = caseScopedName("bootstrap-unknown-digest-client", CASE_ID);
const unknownDigest = "unknown-digest";

const clientContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.bootstrap-unknown-digest-client",
    CASE_ID,
  ),
  displayName: "Trellis Bootstrap Unknown Digest Client",
  description:
    "Creates a bound app session for bootstrap digest cleanup coverage.",
}));

liveTrellisTest({
  name:
    "control-plane.bootstrap-rejects-unknown-contract-digest returns auth_required and deletes the session",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const sqlite = runtime.controlPlane?.sqlite;
    assert(sqlite, "live runtime must expose control-plane SQLite");

    const clientKey = await runtime.registerClient({
      name: clientName,
      contract: clientContract,
    });
    const clientAuth = runtime.clientAuth(clientKey);
    const client = await TrellisClient.connect({
      trellisUrl: runtime.trellisUrl,
      name: clientName,
      contract: clientContract,
      auth: clientAuth.auth,
      onAuthRequired: clientAuth.onAuthRequired,
    }).orThrow();
    await client.connection.close();

    await rewriteSessionContract(sqlite, clientKey.sessionKey, {
      digest: unknownDigest,
      id: clientContract.CONTRACT.id,
      displayName: clientContract.CONTRACT.displayName,
      description: clientContract.CONTRACT.description,
    });

    const auth = await createAuth({ sessionKeySeed: clientKey.seed });
    const response = await fetchClientBootstrap(runtime.trellisUrl, auth);
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.status, "auth_required");
    assertEquals(await sessionExists(sqlite, clientKey.sessionKey), false);
  },
});

async function rewriteSessionContract(
  sqlite: NonNullable<LiveTrellisRuntime["controlPlane"]>["sqlite"],
  sessionKey: string,
  contract: {
    digest: string;
    id: string;
    displayName: string;
    description: string;
  },
): Promise<void> {
  const rows = await sqlite.query(
    "SELECT session FROM sessions WHERE session_key = ?",
    [sessionKey],
  );
  const session: Record<string, unknown> = JSON.parse(String(rows[0]?.session));
  session.contractDigest = contract.digest;
  session.contractId = contract.id;
  session.contractDisplayName = contract.displayName;
  session.contractDescription = contract.description;
  await sqlite.execute(
    "UPDATE sessions SET contract_digest = ?, contract_id = ?, session = ? WHERE session_key = ?",
    [contract.digest, contract.id, JSON.stringify(session), sessionKey],
  );
}

async function sessionExists(
  sqlite: NonNullable<LiveTrellisRuntime["controlPlane"]>["sqlite"],
  sessionKey: string,
): Promise<boolean> {
  const rows = await sqlite.query(
    "SELECT 1 FROM sessions WHERE session_key = ?",
    [sessionKey],
  );
  return rows.length > 0;
}

async function fetchClientBootstrap(
  trellisUrl: string,
  auth: Awaited<ReturnType<typeof createAuth>>,
): Promise<Response> {
  const iat = auth.currentIat();
  const sig = base64urlEncode(
    await auth.sign(await sha256(utf8(`bootstrap-client:${iat}`))),
  );
  return await fetch(new URL("/bootstrap/client", trellisUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionKey: auth.sessionKey, iat, sig }),
  });
}
