import { assertEquals, assertRejects } from "@std/assert";

import { connectClientWithDeps } from "./client_connect.ts";
import type { TrellisAPI } from "./contracts.ts";

const emptyApi = {
  rpc: {},
  operations: {},
  events: {},
  subjects: {},
} satisfies TrellisAPI;

const testContract = {
  CONTRACT: {
    format: "trellis.contract.v1",
    id: "client.example@v1",
    displayName: "Example Client",
    description: "Example client contract",
    kind: "app",
  },
  API: {
    trellis: emptyApi,
  },
} as const;

const TEST_SEED = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

Deno.test("connectClientWithDeps connects after bootstrap returns runtime info", async () => {
  const originalFetch = globalThis.fetch;
  let connectToken = "";
  let connectInboxPrefix = "";

  try {
    globalThis.fetch = (() => {
      return Promise.resolve(new Response(JSON.stringify({
        status: "ready",
        connectInfo: {
          sessionKey: "session-key",
          contractId: testContract.CONTRACT.id,
          contractDigest: "digest-a",
          transports: {
            native: { natsServers: ["nats://127.0.0.1:4222"] },
            websocket: { natsServers: ["ws://localhost:8080"] },
          },
          transport: {
            inboxPrefix: "_INBOX.session-key",
            sentinel: { jwt: "jwt", seed: "seed" },
          },
          auth: {
            mode: "binding_token",
            bindingToken: "binding-token-1",
            expiresAt: "2026-01-01T00:03:00.000Z",
          },
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }) as typeof fetch;

    await assertRejects(
      () => connectClientWithDeps({
        trellisUrl: "https://trellis.example.com",
        contract: testContract,
        auth: {
          mode: "session_key",
          sessionKeySeed: TEST_SEED,
          redirectTo: "https://cli.example.com/callback",
        },
      }, {
        loadTransport: async () => ({
          connect: async (options) => {
            connectToken = String(options.token ?? "");
            connectInboxPrefix = String(options.inboxPrefix ?? "");
            throw new Error("stop-after-connect");
          },
        }),
        now: () => 1_700_000_000_000,
      }),
      Error,
      "stop-after-connect",
    );

    assertEquals(connectInboxPrefix, "_INBOX.session-key");
    assertEquals(connectToken.includes('"bindingToken":"binding-token-1"'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("connectClientWithDeps uses auth continuation when bootstrap requires login", async () => {
  const originalFetch = globalThis.fetch;
  const fetchUrls: string[] = [];

  try {
    let bootstrapCalls = 0;
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = String(input);
      fetchUrls.push(url);
      if (url.endsWith("/bootstrap/client") && bootstrapCalls === 0) {
        bootstrapCalls += 1;
        return Promise.resolve(new Response(JSON.stringify({ status: "auth_required" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.includes("/auth/flow/flow-1/bind")) {
        return Promise.resolve(new Response(JSON.stringify({
          status: "bound",
          bindingToken: "binding-token-1",
          inboxPrefix: "_INBOX.session-key",
          expires: "2026-01-01T00:03:00.000Z",
          sentinel: { jwt: "jwt", seed: "seed" },
          transports: {
            native: { natsServers: ["nats://127.0.0.1:4222"] },
            websocket: { natsServers: ["ws://localhost:8080"] },
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.endsWith("/auth/requests")) {
        return Promise.resolve(new Response(JSON.stringify({
          status: "flow_started",
          flowId: "flow-1",
          loginUrl: "https://trellis.example.com/_trellis/portal/login?flowId=flow-1",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.endsWith("/bootstrap/client") && bootstrapCalls === 1) {
        bootstrapCalls += 1;
        return Promise.resolve(new Response(JSON.stringify({
          status: "ready",
          connectInfo: {
            sessionKey: "session-key",
            contractId: testContract.CONTRACT.id,
            contractDigest: "digest-a",
            transports: {
              native: { natsServers: ["nats://127.0.0.1:4222"] },
              websocket: { natsServers: ["ws://localhost:8080"] },
            },
            transport: {
              inboxPrefix: "_INBOX.session-key",
              sentinel: { jwt: "jwt", seed: "seed" },
            },
            auth: {
              mode: "binding_token",
              bindingToken: "binding-token-1",
              expiresAt: "2026-01-01T00:03:00.000Z",
            },
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }

      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    await assertRejects(
      () => connectClientWithDeps({
        trellisUrl: "https://trellis.example.com",
        contract: testContract,
        auth: {
          mode: "session_key",
          sessionKeySeed: TEST_SEED,
          redirectTo: "https://cli.example.com/callback",
        },
        onAuthRequired: async ({ loginUrl }) => {
          assertEquals(loginUrl, "https://trellis.example.com/_trellis/portal/login?flowId=flow-1");
          return { flowId: "flow-1" };
        },
      }, {
        loadTransport: async () => ({
          connect: async () => {
            throw new Error("stop-after-connect");
          },
        }),
        now: () => 1_700_000_000_000,
      }),
      Error,
      "stop-after-connect",
    );

    assertEquals(fetchUrls.some((url) => url.includes("/auth/flow/flow-1/bind")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
