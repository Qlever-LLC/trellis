import { assert, assertEquals, assertFalse } from "@std/assert";
import Value from "typebox/value";

import {
  AuthLogoutRequestSchema,
  AuthLogoutResponseSchema,
  AuthStartRequestSchema,
  BindSuccessResponseSchema,
  buildLogoutSignaturePayload,
} from "./schemas.ts";

const sessionKey = "A".repeat(43);
const sig = "B".repeat(86);

Deno.test("AuthStartRequestSchema has no browser provider logout metadata", () => {
  assert(Value.Check(AuthStartRequestSchema, {
    redirectTo: "https://app.example.com/dashboard",
    sessionKey,
    sig,
    contractDigest: "digest",
  }));
  assertFalse(Object.hasOwn(AuthStartRequestSchema.properties, "browser"));
});

Deno.test("BindSuccessResponseSchema has no provider logout metadata", () => {
  assert(Value.Check(BindSuccessResponseSchema, {
    status: "bound",
    inboxPrefix: "_INBOX.abc",
    expires: new Date().toISOString(),
    sentinel: {
      jwt: "jwt",
      seed: "seed",
    },
    transports: {
      native: { natsServers: ["nats://127.0.0.1:4222"] },
      websocket: { natsServers: ["ws://localhost:8080"] },
    },
  }));
  assertFalse(
    Object.hasOwn(BindSuccessResponseSchema.properties, "providerLogout"),
  );
});

Deno.test("AuthLogoutRequestSchema accepts additive fields and validates public fields", () => {
  const request = {
    sessionKey,
    iat: 1_735_689_600,
    sig,
    providerLogout: true,
    federatedProviderLogout: false,
    returnTo: "https://app.example.com/signed-out",
    responseMode: "redirect",
  };

  assert(Value.Check(AuthLogoutRequestSchema, request));
  assert(Value.Check(AuthLogoutRequestSchema, {
    ...request,
    futureField: "preserved-by-schema-evolution",
  }));
  assertFalse(Value.Check(AuthLogoutRequestSchema, {
    ...request,
    sessionKey: "short",
  }));
  assertFalse(Value.Check(AuthLogoutRequestSchema, {
    ...request,
    returnTo: "",
  }));
  assertFalse(Value.Check(AuthLogoutRequestSchema, {
    ...request,
    responseMode: "html",
  }));
});

Deno.test("AuthLogoutResponseSchema validates JSON logout responses", () => {
  assert(Value.Check(AuthLogoutResponseSchema, { success: true }));
  assert(Value.Check(AuthLogoutResponseSchema, {
    success: true,
    redirectTo: "https://tenant.example.com/signed-out",
  }));
  assertFalse(Value.Check(AuthLogoutResponseSchema, { success: false }));
  assertFalse(Value.Check(AuthLogoutResponseSchema, {
    success: true,
    extraField: "not part of the clean-break response",
  }));
});

Deno.test("buildLogoutSignaturePayload produces stable canonical JSON", () => {
  assertEquals(
    buildLogoutSignaturePayload({ iat: 1_735_689_600 }),
    '{"iat":1735689600}',
  );
  assertEquals(
    buildLogoutSignaturePayload({
      responseMode: "json",
      returnTo: "https://app.example.com/signed-out",
      federatedProviderLogout: true,
      providerLogout: false,
      iat: 1_735_689_600,
    }),
    '{"federatedProviderLogout":true,"iat":1735689600,"providerLogout":false,"responseMode":"json","returnTo":"https://app.example.com/signed-out"}',
  );
});
