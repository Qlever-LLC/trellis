import { assert, assertArrayIncludes, assertEquals } from "@std/assert";
import { defineAppContract } from "@qlever-llc/trellis";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import {
  caseScopedContractId,
  caseScopedName,
} from "@qlever-llc/trellis-test/integration";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";

const CASE_ID = "control-plane.admin-bootstrap-creates-first-local-admin";
const clientName = caseScopedName(
  "control-plane-admin-bootstrap-probe",
  CASE_ID,
);

const adminBootstrapProbeContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.admin-bootstrap-probe",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Admin Bootstrap Probe",
  description:
    "Verifies first-admin bootstrap yields an authenticated admin session.",
  uses: {
    required: {
      auth: trellisAuth.use({ rpc: { call: ["Auth.Sessions.Me"] } }),
    },
  },
}));

liveTrellisTest({
  name:
    "control-plane.admin-bootstrap-creates-first-local-admin creates an authenticated admin session",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const client = await runtime.connectClient({
      name: clientName,
      contract: adminBootstrapProbeContract,
    });

    try {
      const me = await client.rpc.auth.sessionsMe({}).orThrow();

      assertEquals(me.participantKind, "app");
      assert(me.user !== null, "expected Auth.Sessions.Me to return a user");
      assertEquals(me.user.active, true);
      assertArrayIncludes(me.user.capabilities, ["admin"]);
    } finally {
      await client.connection.close();
    }
  },
});
