import { assertEquals } from "@std/assert";
import {
  createAuth,
  createDeviceNatsAuthToken,
} from "@qlever-llc/trellis/auth";

import { __testing__ } from "./callout.ts";

const TEST_SEED = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TEST_IAT = 1_700_000_000;

async function verifiesNatsConnectToken(args: {
  sessionKey: string;
  iat: number;
  contractDigest: string;
  sig: string;
}): Promise<boolean> {
  return await __testing__.verifyRuntimeAuthTokenSignature(args);
}

for (const principal of ["user", "service"] as const) {
  Deno.test(`auth callout rejects ${principal} token digest tampering via signature`, async () => {
    const auth = await createAuth({ sessionKeySeed: TEST_SEED });
    const sig = await auth.natsConnectSigForIat(TEST_IAT, "digest-a");

    assertEquals(
      await verifiesNatsConnectToken({
        sessionKey: auth.sessionKey,
        iat: TEST_IAT,
        contractDigest: "digest-a",
        sig,
      }),
      true,
    );
    assertEquals(
      await verifiesNatsConnectToken({
        sessionKey: auth.sessionKey,
        iat: TEST_IAT,
        contractDigest: "digest-b",
        sig,
      }),
      false,
    );
  });
}

Deno.test("auth callout rejects device token digest tampering via signature", async () => {
  const auth = await createAuth({ sessionKeySeed: TEST_SEED });
  const token = await createDeviceNatsAuthToken({
    publicIdentityKey: auth.sessionKey,
    identitySeed: TEST_SEED,
    contractDigest: "digest-a",
    iat: TEST_IAT,
  });

  assertEquals(await verifiesNatsConnectToken(token), true);
  assertEquals(
    await verifiesNatsConnectToken({
      ...token,
      contractDigest: "digest-b",
    }),
    false,
  );
});

Deno.test("auth callout rejects service reconnect with stale signed digest", () => {
  const result = __testing__.validateServiceRuntimeDigest({
    presentedContractDigest: "digest-old",
    service: {
      currentContractId: "trellis.worker@v1",
      currentContractDigest: "digest-current",
    },
    deployment: {
      appliedContracts: [{
        contractId: "trellis.worker@v1",
        allowedDigests: ["digest-current"],
      }],
    },
  });

  assertEquals(result, { ok: false, denial: "contract_changed" });
});

Deno.test("auth callout rejects service reconnect when current digest is no longer allowed", () => {
  const result = __testing__.validateServiceRuntimeDigest({
    presentedContractDigest: "digest-current",
    service: {
      currentContractId: "trellis.worker@v1",
      currentContractDigest: "digest-current",
    },
    deployment: {
      appliedContracts: [{
        contractId: "trellis.worker@v1",
        allowedDigests: ["digest-next"],
      }],
    },
  });

  assertEquals(result, { ok: false, denial: "contract_changed" });
});

Deno.test("auth callout accepts service reconnect only for current allowed digest", () => {
  const result = __testing__.validateServiceRuntimeDigest({
    presentedContractDigest: "digest-current",
    service: {
      currentContractId: "trellis.worker@v1",
      currentContractDigest: "digest-current",
    },
    deployment: {
      appliedContracts: [{
        contractId: "trellis.worker@v1",
        allowedDigests: ["digest-current"],
      }],
    },
  });

  assertEquals(result, { ok: true, value: undefined });
});
