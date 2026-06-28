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
} from "./_bootstrap_client.ts";

const CASE_ID = "control-plane.bootstrap-allows-known-inactive-app-digest";
const clientName = caseScopedName("bootstrap-known-inactive-client", CASE_ID);
const clientContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.bootstrap-known-inactive-client",
    CASE_ID,
  ),
  displayName: "Trellis Bootstrap Known Inactive Client",
  description:
    "Creates a known user app contract, which is not an active service catalog entry.",
}));

liveTrellisTest({
  name:
    "control-plane.bootstrap-allows-known-inactive-app-digest returns ready for a known app digest outside the active catalog",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const clientKey = await createBoundClientSession(runtime, {
      name: clientName,
      contract: clientContract,
    });

    const response = await fetchClientBootstrap(
      runtime.trellisUrl,
      clientKey.seed,
    );
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.status, "ready");
    assertEquals(
      body.connectInfo.contractDigest,
      clientContract.CONTRACT_DIGEST,
    );
    assertEquals(body.contract.id, clientContract.CONTRACT.id);
  },
});
