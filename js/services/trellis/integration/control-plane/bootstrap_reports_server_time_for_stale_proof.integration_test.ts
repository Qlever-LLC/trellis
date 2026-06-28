import { assert, assertEquals } from "@std/assert";
import { defineAppContract } from "@qlever-llc/trellis";
import {
  caseScopedContractId,
  caseScopedName,
} from "@qlever-llc/trellis-test/integration";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import {
  createBoundClientSession,
  fetchClientBootstrap,
} from "./_bootstrap_client.ts";

const CASE_ID = "control-plane.bootstrap-reports-server-time-for-stale-proof";
const clientName = caseScopedName("bootstrap-stale-proof-client", CASE_ID);
const clientContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.bootstrap-stale-proof-client",
    CASE_ID,
  ),
  displayName: "Trellis Bootstrap Stale Proof Client",
  description:
    "Creates a bound app session for stale bootstrap proof coverage.",
}));

liveTrellisTest({
  name:
    "control-plane.bootstrap-reports-server-time-for-stale-proof returns iat_out_of_range with serverNow",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const clientKey = await createBoundClientSession(runtime, {
      name: clientName,
      contract: clientContract,
    });
    const staleIat = Math.floor(Date.now() / 1_000) - 120;

    const before = Math.floor(Date.now() / 1_000);
    const response = await fetchClientBootstrap(
      runtime.trellisUrl,
      clientKey.seed,
      {
        iat: staleIat,
      },
    );
    const after = Math.floor(Date.now() / 1_000);
    const body = await response.json();

    assertEquals(response.status, 400);
    assertEquals(body.reason, "iat_out_of_range");
    assert(typeof body.serverNow === "number");
    assert(body.serverNow >= before && body.serverNow <= after + 1);
  },
});
