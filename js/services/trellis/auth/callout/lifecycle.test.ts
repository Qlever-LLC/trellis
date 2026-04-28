import { decode } from "@nats-io/jwt";
import { assertEquals } from "@std/assert";

import { __testing__ } from "./callout.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const TEST_ISSUER_SIGNING_KEY =
  "SAAHJU5XATF552UDGKOSKZ5Y5E3664JBEYIGO4JFWEOQYJRIOHBHUCZJCU";
const TEST_USER_NKEY =
  "UDM3SEDFGZJJPBMGMP4RPLV76Z5KOXZ44G2HQY4JHROQML63QXFT2D4D";
const TEST_SERVER_ID_NKEY =
  "NBEE7XM6PNMN463MJZLLOL2T7L7Q7NI4ZXVRT5LBZDYX2C5PI7LW2FE2";

function responseMessage() {
  let response: string | Uint8Array | undefined;
  return {
    message: {
      respond(payload: string | Uint8Array): boolean {
        response = payload;
        return true;
      },
    },
    get response() {
      return response;
    },
  };
}

Deno.test("auth callout drain waits for in-flight handlers", async () => {
  const done = deferred<void>();
  const inFlight = new Set<Promise<void>>([done.promise]);

  let drained = false;
  const drain = __testing__.waitForInFlightHandlers(inFlight, 500).then(
    (result) => {
      drained = true;
      return result;
    },
  );

  await Promise.resolve();
  assertEquals(drained, false);

  done.resolve();
  assertEquals(await drain, "drained");
  assertEquals(drained, true);
});

Deno.test("auth callout drain is bounded", async () => {
  const never = new Promise<void>(() => {});
  const inFlight = new Set<Promise<void>>([never]);

  assertEquals(
    await __testing__.waitForInFlightHandlers(inFlight, 1),
    "timed_out",
  );
});

Deno.test("auth callout internal error code is stable and generic", () => {
  assertEquals(__testing__.AUTH_CALLOUT_INTERNAL_ERROR, "internal_error");
});

Deno.test("auth callout error responder encodes and seals complete error context", async () => {
  const recorder = responseMessage();
  let encodedResponse = "";

  await __testing__.respondAuthCalloutError({
    message: recorder.message,
    code: "rate_limited",
    issuerSigningKey: TEST_ISSUER_SIGNING_KEY,
    context: {
      userNkey: TEST_USER_NKEY,
      serverIdNkey: TEST_SERVER_ID_NKEY,
      serverXkey: "server-xkey",
    },
    seal: (payload, serverXkey) => {
      assertEquals(serverXkey, "server-xkey");
      encodedResponse = new TextDecoder().decode(payload);
      return new TextEncoder().encode("sealed-response");
    },
  });

  assertEquals(recorder.response, new TextEncoder().encode("sealed-response"));
  const decoded = decode<{ error?: string }>(encodedResponse);
  assertEquals(decoded.sub, TEST_USER_NKEY);
  assertEquals(decoded.aud, TEST_SERVER_ID_NKEY);
  assertEquals(decoded.nats.error, "rate_limited");
});

Deno.test("auth callout error responder sends blank response without complete context", async () => {
  const recorder = responseMessage();
  let sealCalled = false;

  await __testing__.respondAuthCalloutError({
    message: recorder.message,
    code: "internal_error",
    issuerSigningKey: TEST_ISSUER_SIGNING_KEY,
    context: { userNkey: TEST_USER_NKEY },
    seal: () => {
      sealCalled = true;
      return new Uint8Array();
    },
  });

  assertEquals(recorder.response, "");
  assertEquals(sealCalled, false);
});
