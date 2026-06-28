import { assertEquals } from "@std/assert";
import { defineAppContract } from "@qlever-llc/trellis";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import {
  caseScopedContractId,
  caseScopedName,
} from "@qlever-llc/trellis-test/integration";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import {
  clearSessionUserCapabilities,
  createBoundClientSession,
  fetchClientBootstrap,
  requireControlPlaneSqlite,
  sessionExists,
} from "./_bootstrap_client.ts";

const CASE_ID =
  "control-plane.bootstrap-deletes-session-for-insufficient-user-capabilities";
const clientName = caseScopedName(
  "bootstrap-insufficient-user-client",
  CASE_ID,
);
const clientContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.bootstrap-insufficient-user-client",
    CASE_ID,
  ),
  displayName: "Trellis Bootstrap Insufficient User Client",
  description:
    "Creates a bound app session for insufficient-capability bootstrap cleanup.",
  uses: {
    required: {
      auth: trellisAuth.use({ rpc: { call: ["Auth.Users.List"] } }),
    },
  },
}));

liveTrellisTest({
  name:
    "control-plane.bootstrap-deletes-session-for-insufficient-user-capabilities returns auth_required and deletes the session",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const sqlite = requireControlPlaneSqlite(runtime);
    const clientKey = await createBoundClientSession(runtime, {
      name: clientName,
      contract: clientContract,
    });
    await clearSessionUserCapabilities(sqlite, clientKey.sessionKey);

    const response = await fetchClientBootstrap(
      runtime.trellisUrl,
      clientKey.seed,
    );
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.status, "auth_required");
    assertEquals(await sessionExists(sqlite, clientKey.sessionKey), false);
  },
});
