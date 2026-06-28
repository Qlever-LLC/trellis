import { assert, assertEquals } from "@std/assert";
import {
  defineAppContract,
  defineDeviceContract,
  defineServiceContract,
  TrellisClient,
} from "@qlever-llc/trellis";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
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

const CASE_ID = "control-plane.bootstrap-rejects-non-client-contract";
const clientName = caseScopedName(
  "bootstrap-non-client-contract-client",
  CASE_ID,
);

const clientContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.bootstrap-non-client-contract-client",
    CASE_ID,
  ),
  displayName: "Trellis Bootstrap Non-Client Contract Client",
  description:
    "Creates bound app sessions for non-client digest cleanup coverage.",
}));

const serviceContract = defineServiceContract({}, () => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.bootstrap-non-client-contract-service",
    CASE_ID,
  ),
  displayName: "Trellis Bootstrap Non-Client Contract Service",
  description: "Known service contract used as an invalid app session digest.",
}));

const deviceAdminName = caseScopedName(
  "bootstrap-non-client-contract-device-admin",
  CASE_ID,
);

const deviceAdminContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.bootstrap-non-client-contract-device-admin",
    CASE_ID,
  ),
  displayName: "Trellis Bootstrap Non-Client Device Admin",
  description:
    "Admin app used to make a device contract known for bootstrap rejection coverage.",
  uses: {
    required: {
      auth: trellisAuth.use({
        rpc: {
          call: [
            "Auth.Deployments.Create",
            "Auth.DeploymentAuthority.AcceptMigration",
            "Auth.DeploymentAuthority.AcceptUpdate",
            "Auth.DeploymentAuthority.Get",
            "Auth.DeploymentAuthority.Plan",
            "Auth.DeploymentAuthority.Reconcile",
          ],
        },
      }),
    },
  },
}));

const deviceContract = defineDeviceContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.bootstrap-non-client-contract-device",
    CASE_ID,
  ),
  displayName: "Trellis Bootstrap Non-Client Contract Device",
  description: "Known device contract used as an invalid app session digest.",
}));

liveTrellisTest({
  name:
    "control-plane.bootstrap-rejects-non-client-contract returns auth_required and deletes the session",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const sqlite = runtime.controlPlane?.sqlite;
    assert(sqlite, "live runtime must expose control-plane SQLite");
    await runtime.contracts.approve({ contract: serviceContract });
    await approveDeviceContract(runtime);

    await assertRejectedNonClientDigest(runtime, serviceContract);
    await assertRejectedNonClientDigest(runtime, deviceContract);
  },
});

async function approveDeviceContract(
  runtime: LiveTrellisRuntime,
): Promise<void> {
  const admin = await runtime.connectClient({
    name: deviceAdminName,
    contract: deviceAdminContract,
  });
  try {
    const deploymentId = caseScopedName("bootstrap-non-client-device", CASE_ID);
    await admin.rpc.auth.deploymentsCreate({
      deploymentId,
      kind: "device",
      reviewMode: "none",
    }).orThrow();
    const planned = await admin.rpc.auth.deploymentAuthorityPlan({
      deploymentId,
      contract: deviceContract.CONTRACT,
      expectedDigest: deviceContract.CONTRACT_DIGEST,
    }).orThrow();
    const plan = planned.plan as { classification: string; planId: string };
    if (plan.classification === "update") {
      await admin.rpc.auth.deploymentAuthorityAcceptUpdate({
        planId: plan.planId,
      }).orThrow();
    } else {
      await admin.rpc.auth.deploymentAuthorityAcceptMigration({
        planId: plan.planId,
        acknowledgement: "Approved by bootstrap non-client integration test.",
      }).orThrow();
    }
    await admin.rpc.auth.deploymentAuthorityReconcile({ deploymentId })
      .orThrow();
  } finally {
    await admin.connection.close().catch(() => undefined);
  }
}

async function assertRejectedNonClientDigest(
  runtime: LiveTrellisRuntime,
  contract: typeof serviceContract,
): Promise<void> {
  const sqlite = runtime.controlPlane?.sqlite;
  assert(sqlite, "live runtime must expose control-plane SQLite");
  const digest = contract.CONTRACT_DIGEST;
  assert(digest, "test contract must have a digest");

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
    digest,
    id: contract.CONTRACT.id,
    displayName: contract.CONTRACT.displayName,
    description: contract.CONTRACT.description,
  });

  const auth = await createAuth({ sessionKeySeed: clientKey.seed });
  const response = await fetchClientBootstrap(runtime.trellisUrl, auth);
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.status, "auth_required");
  assertEquals(await sessionExists(sqlite, clientKey.sessionKey), false);
}

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
