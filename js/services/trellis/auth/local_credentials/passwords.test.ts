import { assertEquals, assertFalse, assertNotEquals } from "@std/assert";

import {
  createLocalCredentialPassword,
  verifyLocalCredentialPassword,
} from "./passwords.ts";

const testSalt = new Uint8Array([
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
]);

Deno.test("local credential password verifies successfully", async () => {
  const credential = await createLocalCredentialPassword({
    identityId: "idn_local_alice",
    password: "correct horse battery staple",
    salt: testSalt,
    now: new Date("2026-05-09T00:00:00.000Z"),
  });

  assertEquals(credential.passwordAlgorithm, "pbkdf2-sha256");
  assertEquals(credential.passwordParams, {
    v: 1,
    salt: "AAECAwQFBgcICQoLDA0ODw",
    iterations: 310000,
    hashBits: 256,
  });
  assertEquals(credential.failedLoginCount, 0);
  assertEquals(credential.lockedUntil, null);
  assertEquals(
    await verifyLocalCredentialPassword(
      credential,
      "correct horse battery staple",
    ),
    true,
  );
});

Deno.test("local credential password rejects wrong password", async () => {
  const credential = await createLocalCredentialPassword({
    identityId: "idn_local_alice",
    password: "correct horse battery staple",
    salt: testSalt,
  });

  assertFalse(
    await verifyLocalCredentialPassword(credential, "wrong password"),
  );
});

Deno.test("local credential password uses unique salts by default", async () => {
  const first = await createLocalCredentialPassword({
    identityId: "idn_local_alice",
    password: "same password",
  });
  const second = await createLocalCredentialPassword({
    identityId: "idn_local_alice",
    password: "same password",
  });

  assertNotEquals(first.passwordParams.salt, second.passwordParams.salt);
  assertNotEquals(first.passwordHash, second.passwordHash);
});

Deno.test("local credential password rejects unsupported algorithm", async () => {
  const credential = await createLocalCredentialPassword({
    identityId: "idn_local_alice",
    password: "correct horse battery staple",
    salt: testSalt,
  });

  assertFalse(
    await verifyLocalCredentialPassword({
      ...credential,
      passwordAlgorithm: "argon2id",
    }, "correct horse battery staple"),
  );
});

Deno.test("local credential password rejects malformed params", async () => {
  const credential = await createLocalCredentialPassword({
    identityId: "idn_local_alice",
    password: "correct horse battery staple",
    salt: testSalt,
  });

  assertFalse(
    await verifyLocalCredentialPassword({
      ...credential,
      passwordParams: {
        v: 1,
        salt: credential.passwordParams.salt,
        iterations: "1",
        hashBits: 256,
      },
    }, "correct horse battery staple"),
  );
  assertFalse(
    await verifyLocalCredentialPassword({
      ...credential,
      passwordParams: {
        v: 2,
        salt: credential.passwordParams.salt,
        iterations: 1,
        hashBits: 256,
      },
    }, "correct horse battery staple"),
  );
});

Deno.test("local credential password rejects weak or excessive params", async () => {
  const credential = await createLocalCredentialPassword({
    identityId: "idn_local_alice",
    password: "correct horse battery staple",
    salt: testSalt,
  });

  assertFalse(
    await verifyLocalCredentialPassword({
      ...credential,
      passwordParams: {
        ...credential.passwordParams,
        iterations: 1,
      },
    }, "correct horse battery staple"),
  );
  assertFalse(
    await verifyLocalCredentialPassword({
      ...credential,
      passwordParams: {
        ...credential.passwordParams,
        iterations: 2_000_001,
      },
    }, "correct horse battery staple"),
  );
  assertFalse(
    await verifyLocalCredentialPassword({
      ...credential,
      passwordParams: {
        ...credential.passwordParams,
        hashBits: 8,
      },
    }, "correct horse battery staple"),
  );
});
