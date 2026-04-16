import { assertEquals } from "@std/assert";

import { bindFlow, buildLoginUrl, startAuthRequest } from "./login.ts";
import type { SessionKeyHandle } from "./session.ts";

async function createHandle(): Promise<SessionKeyHandle> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    false,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const publicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", keyPair.publicKey),
  );
  const sessionKey = btoa(String.fromCharCode(...publicKeyRaw)).replace(
    /\+/g,
    "-",
  ).replace(/\//g, "_").replace(/=+$/g, "");
  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyRaw,
    sessionKey,
  };
}

Deno.test("buildLoginUrl targets auth chooser when provider is omitted", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input, init) => {
      assertEquals(String(input), "http://localhost:3000/auth/requests");
      assertEquals(init?.method, "POST");
      const body = JSON.parse(String(init?.body));
      assertEquals(body.redirectTo, "http://localhost:5173/profile");
      assertEquals(body.contract, { id: "demo.app@v1" });
      assertEquals(body.context, { subtitle: "Welcome back" });
      return new Response(JSON.stringify({
        status: "flow_started",
        flowId: "flow-1",
        loginUrl: "http://localhost:3000/_trellis/portal/login?flowId=flow-1",
      }));
    }) as typeof fetch;

    const url = await buildLoginUrl({
      authUrl: "http://localhost:3000",
      redirectTo: "http://localhost:5173/profile",
      handle: await createHandle(),
      contract: { id: "demo.app@v1" },
      context: { subtitle: "Welcome back" },
    });

    assertEquals(url, "http://localhost:3000/_trellis/portal/login?flowId=flow-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("buildLoginUrl preserves explicit provider selection through flow creation", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      assertEquals(body.provider, "github");
      return new Response(JSON.stringify({
        status: "flow_started",
        flowId: "flow-1",
        loginUrl: "http://localhost:3000/auth/login/github?flowId=flow-1",
      }));
    }) as typeof fetch;

    const url = await buildLoginUrl({
      authUrl: "http://localhost:3000",
      provider: "github",
      redirectTo: "http://localhost:5173/profile",
      handle: await createHandle(),
      contract: { id: "demo.app@v1" },
    });

    assertEquals(url, "http://localhost:3000/auth/login/github?flowId=flow-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("startAuthRequest returns bound immediately when auth auto-approves", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      status: "bound",
      bindingToken: "binding-token",
      inboxPrefix: "_INBOX.abc123",
      expires: "2026-01-01T00:00:00.000Z",
      sentinel: { jwt: "jwt", seed: "seed" },
      transports: {
        native: { natsServers: ["nats://localhost:4222"] },
      },
    }))) as typeof fetch;

    const response = await startAuthRequest({
      authUrl: "http://localhost:3000",
      redirectTo: "http://localhost:5173/profile",
      handle: await createHandle(),
      contract: { id: "demo.app@v1" },
    });

    assertEquals(response.status, "bound");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("bindFlow posts a flow-scoped bind request", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      assertEquals(url, "http://localhost:3000/auth/flow/flow-123/bind");
      assertEquals(init?.method, "POST");
      assertEquals(init?.headers, { "Content-Type": "application/json" });
      const body = JSON.parse(String(init?.body));
      assertEquals(body.sessionKey.length, 43);
      assertEquals(typeof body.sig, "string");
      assertEquals("authToken" in body, false);
      return new Response(
        JSON.stringify({
          status: "bound",
          bindingToken: "binding-token",
          inboxPrefix: "_INBOX.abc123",
          expires: "2026-01-01T00:00:00.000Z",
          sentinel: { jwt: "jwt", seed: "seed" },
          transports: {
            native: { natsServers: ["nats://localhost:4222"] },
            websocket: { natsServers: ["ws://localhost:8080"] },
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as typeof fetch;

    const response = await bindFlow(
      { authUrl: "http://localhost:3000" },
      await createHandle(),
      "flow-123",
    );
    assertEquals(response.status, "bound");
    if (response.status !== "bound") {
      throw new Error("expected bound response");
    }
    assertEquals(response.transports.websocket?.natsServers, [
      "ws://localhost:8080",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
