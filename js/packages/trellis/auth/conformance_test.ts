import { assert, assertEquals } from "@std/assert";

import {
  base64urlEncode,
  buildProofInput,
  createAuth,
  sha256,
  utf8,
  verifyProof,
} from "./mod.ts";

type Fixture = {
  name: string;
  seed: string;
  sessionKey: string;
  oauthInit: {
    redirectTo: string;
    sig: string;
  };
  bind: {
    authToken: string;
    sig: string;
  };
  natsConnect: {
    iat: number;
    iatSig: string;
  };
  rpcProof: {
    subject: string;
    payload: string;
    payloadHashBase64url: string;
    proofInputHex: string;
    proofDigestBase64url: string;
    proof: string;
  };
};

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("shared auth-proof vectors match JS implementation", async () => {
  const fixtures = JSON.parse(
    await Deno.readTextFile(
      new URL("../../../../conformance/auth-proof/vectors.json", import.meta.url),
    ),
  ) as Fixture[];

  assert(fixtures.length >= 2);

  for (const fixture of fixtures) {
    const auth = await createAuth({ sessionKeySeed: fixture.seed });
    assertEquals(auth.sessionKey, fixture.sessionKey);

    assertEquals(
      await auth.oauthInitSig(fixture.oauthInit.redirectTo),
      fixture.oauthInit.sig,
    );
    assertEquals(await auth.bindSig(fixture.bind.authToken), fixture.bind.sig);
    assertEquals(
      await auth.natsConnectSigForIat(fixture.natsConnect.iat),
      fixture.natsConnect.iatSig,
    );

    const payloadBytes = utf8(fixture.rpcProof.payload);
    const payloadHash = await sha256(payloadBytes);
    assertEquals(base64urlEncode(payloadHash), fixture.rpcProof.payloadHashBase64url);

    const proofInput = buildProofInput(
      fixture.sessionKey,
      fixture.rpcProof.subject,
      payloadHash,
    );
    assertEquals(toHex(proofInput), fixture.rpcProof.proofInputHex);

    const proofDigest = await sha256(proofInput);
    assertEquals(base64urlEncode(proofDigest), fixture.rpcProof.proofDigestBase64url);

    assertEquals(
      await auth.createProof(fixture.rpcProof.subject, payloadHash),
      fixture.rpcProof.proof,
    );

    assert(
      await verifyProof(
        fixture.sessionKey,
        {
          sessionKey: fixture.sessionKey,
          subject: fixture.rpcProof.subject,
          payloadHash,
        },
        fixture.rpcProof.proof,
      ),
    );
  }
});
