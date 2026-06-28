import { assertEquals } from "@std/assert";
import { defineAppContract } from "@qlever-llc/trellis";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import {
  caseScopedContractId,
  caseScopedName,
} from "@qlever-llc/trellis-test/integration";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import {
  createBoundClientSession,
  fetchClientBootstrap,
} from "./_bootstrap_client.ts";

const CASE_ID = "control-plane.bootstrap-selects-exact-session-contract-digest";
const clientName = caseScopedName("bootstrap-exact-digest-client", CASE_ID);
const contractId = caseScopedContractId(
  "trellis.integration.control-plane.bootstrap-exact-digest-client",
  CASE_ID,
);

const firstContract = defineAppContract(() => ({
  id: contractId,
  displayName: "Trellis Bootstrap Exact Digest Client",
  description: "First known client contract revision.",
}));

const sessionContract = defineAppContract(() => ({
  id: contractId,
  displayName: "Trellis Bootstrap Exact Digest Client",
  description: "Session-bound client contract revision.",
  uses: {
    required: {
      auth: trellisAuth.use({ rpc: { call: ["Auth.Users.List"] } }),
    },
  },
}));

liveTrellisTest({
  name:
    "control-plane.bootstrap-selects-exact-session-contract-digest returns the stored session digest when multiple known digests share a contract id",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    await createBoundClientSession(runtime, {
      name: clientName,
      contract: firstContract,
    });
    const clientKey = await createBoundClientSession(runtime, {
      name: clientName,
      contract: sessionContract,
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
      sessionContract.CONTRACT_DIGEST,
    );
    assertEquals(
      body.contract.description,
      sessionContract.CONTRACT.description,
    );
  },
});
