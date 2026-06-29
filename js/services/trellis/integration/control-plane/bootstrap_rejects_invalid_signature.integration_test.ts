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
  signClientBootstrapProof,
} from "./_bootstrap_client.ts";

const CASE_ID = "control-plane.bootstrap-rejects-invalid-signature";
const clientName = caseScopedName(
  "bootstrap-invalid-signature-client",
  CASE_ID,
);
const clientContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.bootstrap-invalid-signature-client",
    CASE_ID,
  ),
  displayName: "Trellis Bootstrap Invalid Signature Client",
  description:
    "Creates a bound app session for invalid bootstrap signature coverage.",
}));

liveTrellisTest({
  name:
    "control-plane.bootstrap-rejects-invalid-signature returns invalid_signature",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const clientKey = await createBoundClientSession(runtime, {
      name: clientName,
      contract: clientContract,
    });
    const iat = Math.floor(Date.now() / 1_000);
    const validSig = await signClientBootstrapProof(clientKey.seed, iat);
    const sig = `${validSig.startsWith("A") ? "B" : "A"}${validSig.slice(1)}`;

    const response = await fetchClientBootstrap(
      runtime.trellisUrl,
      clientKey.seed,
      {
        iat,
        sig,
      },
    );
    const body = await response.json();

    assertEquals(response.status, 400);
    assertEquals(body.reason, "invalid_signature");
  },
});
