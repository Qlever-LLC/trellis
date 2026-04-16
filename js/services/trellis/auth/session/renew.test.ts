import { assertEquals } from "@std/assert";
import { isErr } from "@qlever-llc/result";

import { createAuthRenewBindingTokenHandler } from "./renew.ts";

Deno.test("Auth.RenewBindingToken returns contract_changed on digest mismatch", async () => {
  const handler = createAuthRenewBindingTokenHandler({
    loadUserSession: async () => ({
      contractDigest: "digest-old",
      trellisId: "tid_123",
    }),
    issueBindingToken: async () => ({
      status: "bound",
      bindingToken: "binding-token",
      inboxPrefix: "_INBOX.abc",
      expires: "2026-01-01T00:00:00.000Z",
      sentinel: { jwt: "jwt", seed: "seed" },
      transports: {},
    }),
  });

  const result = await handler(
    { contractDigest: "digest-new" },
    { caller: { trellisId: "tid_123" }, sessionKey: "session-key" },
  );
  const value = result.take();
  if (isErr(value)) throw value.error;

  assertEquals(value, { status: "contract_changed" });
});

Deno.test("Auth.RenewBindingToken returns bound when digest still matches", async () => {
  const handler = createAuthRenewBindingTokenHandler({
    loadUserSession: async () => ({
      contractDigest: "digest-a",
      trellisId: "tid_123",
    }),
    issueBindingToken: async () => ({
      status: "bound",
      bindingToken: "binding-token",
      inboxPrefix: "_INBOX.abc",
      expires: "2026-01-01T00:00:00.000Z",
      sentinel: { jwt: "jwt", seed: "seed" },
      transports: {
        websocket: { natsServers: ["ws://localhost:8080"] },
      },
    }),
  });

  const result = await handler(
    { contractDigest: "digest-a" },
    { caller: { trellisId: "tid_123" }, sessionKey: "session-key" },
  );
  const value = result.take();
  if (isErr(value)) throw value.error;

  assertEquals(value, {
    status: "bound",
    bindingToken: "binding-token",
    inboxPrefix: "_INBOX.abc",
    expires: "2026-01-01T00:00:00.000Z",
    sentinel: { jwt: "jwt", seed: "seed" },
    transports: {
      websocket: { natsServers: ["ws://localhost:8080"] },
    },
  });
});
