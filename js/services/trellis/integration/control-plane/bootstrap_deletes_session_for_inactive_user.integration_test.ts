import { assertEquals } from "@std/assert";
import { defineAppContract } from "@qlever-llc/trellis";
import {
  caseScopedContractId,
  caseScopedName,
} from "@qlever-llc/trellis-test/integration";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import {
  createBoundClientSession,
  fetchClientBootstrap,
  markSessionUserInactive,
  requireControlPlaneSqlite,
  sessionExists,
} from "./_bootstrap_client.ts";

const CASE_ID = "control-plane.bootstrap-deletes-session-for-inactive-user";
const clientName = caseScopedName("bootstrap-inactive-user-client", CASE_ID);
const clientContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.bootstrap-inactive-user-client",
    CASE_ID,
  ),
  displayName: "Trellis Bootstrap Inactive User Client",
  description:
    "Creates a bound app session for inactive-user bootstrap cleanup.",
}));

liveTrellisTest({
  name:
    "control-plane.bootstrap-deletes-session-for-inactive-user returns auth_required and deletes the session",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const sqlite = requireControlPlaneSqlite(runtime);
    const clientKey = await createBoundClientSession(runtime, {
      name: clientName,
      contract: clientContract,
    });
    await markSessionUserInactive(sqlite, clientKey.sessionKey);

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
