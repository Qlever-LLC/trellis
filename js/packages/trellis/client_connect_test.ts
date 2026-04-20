import { assert, assertEquals, assertRejects } from "@std/assert";
import type { NatsConnection } from "@nats-io/nats-core";
import { createUser } from "@nats-io/nkeys";

import { base64urlEncode, createAuth } from "./auth/mod.ts";
import type { SessionKeyHandle } from "./auth/browser.ts";
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
const textDecoder = new TextDecoder();

async function createBrowserHandle(): Promise<SessionKeyHandle> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    false,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const publicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", keyPair.publicKey),
  );
  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyRaw,
    sessionKey: base64urlEncode(publicKeyRaw),
  };
}

function authTokenFromAuthenticator(authenticator: unknown): string {
  const candidates = Array.isArray(authenticator) ? authenticator : [authenticator];
  for (const candidate of candidates) {
    if (typeof candidate !== "function") continue;
    try {
      const value = candidate();
      if (value && typeof value === "object" && "auth_token" in value && typeof value.auth_token === "string") {
        return value.auth_token;
      }
    } catch {
      continue;
    }
  }

  throw new Error("Expected runtime authenticator to expose auth_token");
}

function jwtFromAuthenticator(authenticator: unknown): string {
  const candidates = Array.isArray(authenticator) ? authenticator : [authenticator];
  for (const candidate of candidates) {
    if (typeof candidate !== "function") continue;
    try {
      const value = candidate();
      if (value && typeof value === "object" && "jwt" in value && typeof value.jwt === "string") {
        return value.jwt;
      }
    } catch {
      continue;
    }
  }

  throw new Error("Expected runtime authenticator to expose jwt");
}

async function waitFor(condition: () => boolean, attempts = 50): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

function createControllableNatsConnection(): { connection: NatsConnection; close(): Promise<void> } {
  let resolveClosed = () => {};
  const closedPromise = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const connection: NatsConnection & { options: { inboxPrefix: string } } = {
    options: { inboxPrefix: "_INBOX" },
    closed: async () => await closedPromise,
    close: async () => {
      resolveClosed();
    },
    publish: () => {},
    publishMessage: () => {},
    respondMessage: () => false,
    subscribe: () => {
      throw new Error("subscribe should not be called in this test");
    },
    request: async () => {
      throw new Error("request should not be called in this test");
    },
    requestMany: async () => {
      throw new Error("requestMany should not be called in this test");
    },
    flush: async () => {},
    drain: async () => {},
    isClosed: () => false,
    isDraining: () => false,
    getServer: () => "nats://127.0.0.1:4222",
    status: () => ({
      async *[Symbol.asyncIterator]() {},
    }),
    stats: () => ({ inBytes: 0, outBytes: 0, inMsgs: 0, outMsgs: 0 }),
    rtt: async () => 0,
    reconnect: async () => {},
  };
  return {
    connection,
    close: async () => {
      resolveClosed();
      await closedPromise;
    },
  };
}

Deno.test("connectClientWithDeps uses reconnect-safe iat auth payloads for runtime connect", async () => {
  const originalFetch = globalThis.fetch;
  let connectInboxPrefix = "";
  let connectAuthenticator: unknown;
  let nowMs = 1_700_000_000_000;

  try {
    globalThis.fetch = (() => {
      return Promise.resolve(new Response(JSON.stringify({
        status: "ready",
        serverNow: 1_700_000_000,
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
            connectAuthenticator = options.authenticator;
            connectInboxPrefix = String(options.inboxPrefix ?? "");
            throw new Error("stop-after-connect");
          },
        }),
        now: () => nowMs,
      }),
      Error,
      "stop-after-connect",
    );

    const auth = await createAuth({ sessionKeySeed: TEST_SEED });
    const firstToken = JSON.parse(authTokenFromAuthenticator(connectAuthenticator)) as {
      sessionKey: string;
      iat: number;
      contractDigest: string;
      sig: string;
      bindingToken?: string;
    };
    nowMs += 31_000;
    const secondToken = JSON.parse(authTokenFromAuthenticator(connectAuthenticator)) as typeof firstToken;

    assertEquals(connectInboxPrefix, "_INBOX.session-key");
    assertEquals(firstToken.sessionKey, auth.sessionKey);
    assertEquals(firstToken.contractDigest, "digest-a");
    assertEquals(firstToken.bindingToken, undefined);
    assertEquals(firstToken.sig, await auth.natsConnectSigForIat(firstToken.iat));
    assert(secondToken.iat > firstToken.iat);
    assertEquals(secondToken.sig, await auth.natsConnectSigForIat(secondToken.iat));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("connectClientWithDeps retries bootstrap once after iat_out_of_range using server offset", async () => {
  const originalFetch = globalThis.fetch;
  const bootstrapIats: number[] = [];

  try {
    globalThis.fetch = ((input: URL | Request | string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/bootstrap/client")) {
        const body = JSON.parse(String(init?.body)) as { iat: number };
        bootstrapIats.push(body.iat);
        if (bootstrapIats.length === 1) {
          return Promise.resolve(new Response(JSON.stringify({
            reason: "iat_out_of_range",
            serverNow: 1_700_000_030,
          }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }));
        }

        return Promise.resolve(new Response(JSON.stringify({
          status: "ready",
          serverNow: 1_700_000_030,
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

    assertEquals(bootstrapIats, [1_700_000_000, 1_700_000_030]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("connectClientWithDeps preserves trellisUrl path when calling bootstrap", async () => {
  const originalFetch = globalThis.fetch;
  const fetchUrls: string[] = [];

  try {
    globalThis.fetch = ((input: URL | Request | string, init?: RequestInit) => {
      const url = String(input);
      fetchUrls.push(url);
      return Promise.resolve(new Response(JSON.stringify({
        status: "ready",
        serverNow: 1_700_000_000,
        connectInfo: {
          sessionKey: "session-key",
          contractId: testContract.CONTRACT.id,
          contractDigest: "digest-a",
          transports: {
            native: { natsServers: ["nats://127.0.0.1:4222"] },
          },
          transport: {
            inboxPrefix: "_INBOX.session-key",
            sentinel: { jwt: "jwt", seed: "seed" },
          },
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }) as typeof fetch;

    await assertRejects(
      () => connectClientWithDeps({
        trellisUrl: "https://trellis.example.com/base",
        contract: testContract,
        auth: {
          mode: "session_key",
          sessionKeySeed: TEST_SEED,
          redirectTo: "https://cli.example.com/callback",
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

    assertEquals(fetchUrls[0], "https://trellis.example.com/base/bootstrap/client");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("connectClientWithDeps precomputes fresh browser-mode runtime auth tokens for later reconnects", async () => {
  const originalFetch = globalThis.fetch;
  let connectAuthenticator: unknown;
  let nowMs = 1_700_000_000_000;
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    false,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));

  try {
    globalThis.fetch = (() => {
      return Promise.resolve(new Response(JSON.stringify({
        status: "ready",
        serverNow: 1_700_000_000,
        connectInfo: {
          sessionKey: "session-key",
          contractId: testContract.CONTRACT.id,
          contractDigest: "digest-a",
          transports: {
            native: { natsServers: ["nats://127.0.0.1:4222"] },
          },
          transport: {
            inboxPrefix: "_INBOX.session-key",
            sentinel: { jwt: "jwt", seed: "seed" },
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
          redirectTo: "https://app.example.com/callback",
          handle: {
            privateKey: keyPair.privateKey,
            publicKey: keyPair.publicKey,
            publicKeyRaw,
            sessionKey: base64urlEncode(publicKeyRaw),
          },
        },
      }, {
        loadTransport: async () => ({
          connect: async (options) => {
            connectAuthenticator = options.authenticator;
            throw new Error("stop-after-connect");
          },
        }),
        now: () => nowMs,
        setInterval: () => 1,
        clearInterval: () => {},
      }),
      Error,
      "stop-after-connect",
    );

    const firstToken = JSON.parse(authTokenFromAuthenticator(connectAuthenticator)) as {
      iat: number;
      contractDigest: string;
    };
    nowMs += 31_000;
    const secondToken = JSON.parse(authTokenFromAuthenticator(connectAuthenticator)) as {
      iat: number;
      contractDigest: string;
    };

    assertEquals(firstToken.contractDigest, "digest-a");
    assertEquals(secondToken.contractDigest, "digest-a");
    assert(secondToken.iat > firstToken.iat);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("connectClientWithDeps does not bind browser callbacks from window.location implicitly", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const fetchUrls: string[] = [];
  const handle = await createBrowserHandle();

  try {
    Object.defineProperty(globalThis, "window", {
      value: {
        location: {
          href: "https://app.example.com/callback?flowId=implicit-flow&redirectTo=%2Fdashboard",
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: {},
      configurable: true,
      writable: true,
    });
    globalThis.fetch = ((input: URL | Request | string, init?: RequestInit) => {
      const url = String(input);
      fetchUrls.push(url);
      if (url.endsWith("/bootstrap/client")) {
        return Promise.resolve(new Response(JSON.stringify({
          status: "ready",
          serverNow: 1_700_000_000,
          connectInfo: {
            sessionKey: "session-key",
            contractId: testContract.CONTRACT.id,
            contractDigest: "digest-a",
            transports: {
              native: { natsServers: ["nats://127.0.0.1:4222"] },
            },
            transport: {
              inboxPrefix: "_INBOX.session-key",
              sentinel: { jwt: "jwt", seed: "seed" },
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
        auth: { handle },
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

    assertEquals(fetchUrls, ["https://trellis.example.com/bootstrap/client"]);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: originalDocument,
      configurable: true,
      writable: true,
    });
  }
});

Deno.test("connectClientWithDeps requires explicit browser redirect state when reauth is needed", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const handle = await createBrowserHandle();

  try {
    Object.defineProperty(globalThis, "window", {
      value: {
        location: {
          href: "https://app.example.com/callback?redirectTo=%2Fdashboard",
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: {},
      configurable: true,
      writable: true,
    });
    globalThis.fetch = ((input: URL | Request | string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/bootstrap/client")) {
        return Promise.resolve(new Response(JSON.stringify({
          status: "auth_required",
          serverNow: 1_700_000_000,
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
        auth: { handle },
      }, {
        loadTransport: async () => {
          throw new Error("loadTransport should not be called");
        },
        now: () => 1_700_000_000_000,
      }),
      Error,
      "Client authentication requires a redirectTo URL",
    );
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: originalDocument,
      configurable: true,
      writable: true,
    });
  }
});

Deno.test("connectClientWithDeps rebootstraps browser auth when token lookahead is exhausted", async () => {
  const originalFetch = globalThis.fetch;
  let connectAuthenticator: unknown;
  let nowMs = 1_700_000_000_000;
  let bootstrapCalls = 0;
  const testConnection = createControllableNatsConnection();
  const initialSentinelSeed = textDecoder.decode(createUser().getSeed());
  const refreshedSentinelSeed = textDecoder.decode(createUser().getSeed());
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    false,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));

  try {
    globalThis.fetch = ((input: URL | Request | string, init?: RequestInit) => {
      const url = String(input);
      if (!url.endsWith("/bootstrap/client")) {
        throw new Error(`Unexpected fetch ${url}`);
      }
      bootstrapCalls += 1;
      const contractDigest = bootstrapCalls === 1 ? "digest-a" : "digest-b";
      const sentinel = bootstrapCalls === 1
        ? { jwt: "jwt-a", seed: initialSentinelSeed }
        : { jwt: "jwt-b", seed: refreshedSentinelSeed };
      return Promise.resolve(new Response(JSON.stringify({
        status: "ready",
        serverNow: 1_700_000_000 + (bootstrapCalls - 1) * 301,
        connectInfo: {
          sessionKey: "session-key",
          contractId: testContract.CONTRACT.id,
          contractDigest,
          transports: {
            native: { natsServers: ["nats://127.0.0.1:4222"] },
          },
              transport: {
                inboxPrefix: "_INBOX.session-key",
                sentinel,
              },
            },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }) as typeof fetch;

    await connectClientWithDeps({
        trellisUrl: "https://trellis.example.com",
        contract: testContract,
        auth: {
          handle: {
            privateKey: keyPair.privateKey,
            publicKey: keyPair.publicKey,
            publicKeyRaw,
            sessionKey: base64urlEncode(publicKeyRaw),
          },
        },
      }, {
        loadTransport: async () => ({
          connect: async (options) => {
            connectAuthenticator = options.authenticator;
            return testConnection.connection;
          },
        }),
        now: () => nowMs,
        setInterval: () => 1,
        clearInterval: () => {},
      });

    nowMs += 301_000;
    authTokenFromAuthenticator(connectAuthenticator);
    await waitFor(() => bootstrapCalls === 2);
    await waitFor(() => {
      const token = JSON.parse(authTokenFromAuthenticator(connectAuthenticator)) as {
        contractDigest?: string;
      };
      return token.contractDigest === "digest-b";
    });
    const token = JSON.parse(authTokenFromAuthenticator(connectAuthenticator)) as {
      bindingToken?: string;
      contractDigest?: string;
      iat?: number;
    };

    assertEquals(bootstrapCalls, 2);
    assertEquals(token.bindingToken, undefined);
    assertEquals(token.contractDigest, "digest-b");
    assertEquals(jwtFromAuthenticator(connectAuthenticator), "jwt-b");
    assert(typeof token.iat === "number");
    await testConnection.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("connectClientWithDeps recovers exhausted browser auth through auth continuation", async () => {
  const originalFetch = globalThis.fetch;
  let connectAuthenticator: unknown;
  let nowMs = 1_700_000_000_000;
  let bootstrapCalls = 0;
  let authRequiredCalls = 0;
  let currentUrlValue = new URL("https://app.example.com/start");
  const testConnection = createControllableNatsConnection();
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    false,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));

  try {
    globalThis.fetch = ((input: URL | Request | string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/bootstrap/client")) {
        bootstrapCalls += 1;
        if (bootstrapCalls === 1) {
          return Promise.resolve(new Response(JSON.stringify({
            status: "ready",
            serverNow: 1_700_000_000,
            connectInfo: {
              sessionKey: "session-key",
              contractId: testContract.CONTRACT.id,
              contractDigest: "digest-a",
              transports: { native: { natsServers: ["nats://127.0.0.1:4222"] } },
              transport: {
                inboxPrefix: "_INBOX.session-key",
                sentinel: { jwt: "jwt", seed: "seed" },
              },
            },
          }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        if (bootstrapCalls === 2) {
          return Promise.resolve(new Response(JSON.stringify({
            status: "auth_required",
            serverNow: 1_700_000_301,
          }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        return Promise.resolve(new Response(JSON.stringify({
          status: "ready",
          serverNow: 1_700_000_301,
          connectInfo: {
            sessionKey: "session-key",
            contractId: testContract.CONTRACT.id,
            contractDigest: "digest-c",
            transports: { native: { natsServers: ["nats://127.0.0.1:4222"] } },
            transport: {
              inboxPrefix: "_INBOX.session-key",
              sentinel: { jwt: "jwt", seed: "seed" },
            },
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      if (url.endsWith("/auth/requests")) {
        authRequiredCalls += 1;
        const body = JSON.parse(String(init?.body ?? "null"));
        assertEquals(body.redirectTo, "https://app.example.com/after");
        return Promise.resolve(new Response(JSON.stringify({
          status: "flow_started",
          flowId: "flow-2",
          loginUrl: "https://trellis.example.com/_trellis/portal/users/login?flowId=flow-2",
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      if (url.includes("/auth/flow/flow-2/bind")) {
        return Promise.resolve(new Response(JSON.stringify({
          status: "bound",
          bindingToken: "binding-token-2",
          inboxPrefix: "_INBOX.session-key",
          expires: "2026-01-01T00:08:00.000Z",
          sentinel: { jwt: "jwt", seed: "seed" },
          transports: {
            native: { natsServers: ["nats://127.0.0.1:4222"] },
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    await connectClientWithDeps({
        trellisUrl: "https://trellis.example.com",
        contract: testContract,
        auth: {
          currentUrl: () => currentUrlValue,
          handle: {
            privateKey: keyPair.privateKey,
            publicKey: keyPair.publicKey,
            publicKeyRaw,
            sessionKey: base64urlEncode(publicKeyRaw),
          },
        },
        onAuthRequired: async () => ({ flowId: "flow-2" }),
      }, {
        loadTransport: async () => ({
          connect: async (options) => {
            connectAuthenticator = options.authenticator;
            return testConnection.connection;
          },
        }),
        now: () => nowMs,
        setInterval: () => 1,
        clearInterval: () => {},
      });

    currentUrlValue = new URL("https://app.example.com/after");
    nowMs += 301_000;
    authTokenFromAuthenticator(connectAuthenticator);
    await waitFor(() => bootstrapCalls === 3 && authRequiredCalls === 1);
    await waitFor(() => {
      const token = JSON.parse(authTokenFromAuthenticator(connectAuthenticator)) as {
        contractDigest?: string;
      };
      return token.contractDigest === "digest-c";
    });
    const token = JSON.parse(authTokenFromAuthenticator(connectAuthenticator)) as {
      bindingToken?: string;
      contractDigest?: string;
    };

    assertEquals(authRequiredCalls, 1);
    assertEquals(bootstrapCalls, 3);
    assertEquals(token.bindingToken, undefined);
    assertEquals(token.contractDigest, "digest-c");
    await testConnection.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
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
        return Promise.resolve(new Response(JSON.stringify({ status: "auth_required", serverNow: 1_700_000_000 }), {
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
          loginUrl: "https://trellis.example.com/_trellis/portal/users/login?flowId=flow-1",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.endsWith("/bootstrap/client") && bootstrapCalls === 1) {
        bootstrapCalls += 1;
        return Promise.resolve(new Response(JSON.stringify({
          status: "ready",
          serverNow: 1_700_000_000,
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
          assertEquals(loginUrl, "https://trellis.example.com/_trellis/portal/users/login?flowId=flow-1");
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

Deno.test("connectClientWithDeps cleans up stale browser callback URLs when bind is expired", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const currentUrl = new URL("https://app.example.com/dashboard?flowId=flow-expired&redirectTo=%2Fdashboard#section");
  const replaceStateCalls: Array<{ url?: string | URL | null }> = [];
  const handle = await createBrowserHandle();

  try {
    Object.defineProperty(globalThis, "window", {
      value: {
        history: {
          replaceState: (_: unknown, __: string, url?: string | URL | null) => {
            replaceStateCalls.push({ url });
          },
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: {},
      configurable: true,
      writable: true,
    });
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = String(input);
      if (url.includes("/auth/flow/flow-expired/bind")) {
        return Promise.resolve(new Response(JSON.stringify({ status: "expired" }), {
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
          handle,
          currentUrl,
        },
      }, {
        loadTransport: async () => {
          throw new Error("loadTransport should not be called");
        },
        now: () => 1_700_000_000_000,
      }),
      Error,
      "Client bind did not complete: expired",
    );

    assertEquals(currentUrl.toString(), "https://app.example.com/dashboard?redirectTo=%2Fdashboard#section");
    assertEquals(replaceStateCalls, [{ url: "/dashboard?redirectTo=%2Fdashboard#section" }]);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: originalDocument,
      configurable: true,
      writable: true,
    });
  }
});

Deno.test("connectClientWithDeps reauths when bootstrap resolves a different contract", async () => {
  const originalFetch = globalThis.fetch;
  const fetchUrls: string[] = [];

  try {
    let bootstrapCalls = 0;
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = String(input);
      fetchUrls.push(url);
      if (url.endsWith("/bootstrap/client") && bootstrapCalls === 0) {
        bootstrapCalls += 1;
        return Promise.resolve(new Response(JSON.stringify({
          status: "ready",
          serverNow: 1_700_000_000,
          connectInfo: {
            sessionKey: "session-key",
            contractId: "other.client@v1",
            contractDigest: "digest-other",
            transports: {
              native: { natsServers: ["nats://127.0.0.1:4222"] },
              websocket: { natsServers: ["ws://localhost:8080"] },
            },
            transport: {
              inboxPrefix: "_INBOX.session-key",
              sentinel: { jwt: "jwt", seed: "seed" },
            },
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.includes("/auth/flow/flow-3/bind")) {
        return Promise.resolve(new Response(JSON.stringify({
          status: "bound",
          bindingToken: "binding-token-3",
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
          flowId: "flow-3",
          loginUrl: "https://trellis.example.com/_trellis/portal/users/login?flowId=flow-3",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.endsWith("/bootstrap/client") && bootstrapCalls === 1) {
        bootstrapCalls += 1;
        return Promise.resolve(new Response(JSON.stringify({
          status: "ready",
          serverNow: 1_700_000_000,
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
        onAuthRequired: async () => ({ flowId: "flow-3" }),
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

    assertEquals(fetchUrls.some((url) => url.includes("/auth/requests")), true);
    assertEquals(fetchUrls.some((url) => url.includes("/auth/flow/flow-3/bind")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("connectClientWithDeps reauths when bootstrap reports insufficient permissions", async () => {
  const originalFetch = globalThis.fetch;
  const fetchUrls: string[] = [];

  try {
    let bootstrapCalls = 0;
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = String(input);
      fetchUrls.push(url);
      if (url.endsWith("/bootstrap/client") && bootstrapCalls === 0) {
        bootstrapCalls += 1;
        return Promise.resolve(new Response(JSON.stringify({
          status: "not_ready",
          reason: "insufficient_permissions",
          serverNow: 1_700_000_000,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.endsWith("/auth/requests")) {
        return Promise.resolve(new Response(JSON.stringify({
          status: "flow_started",
          flowId: "flow-2",
          loginUrl: "https://trellis.example.com/_trellis/portal/users/login?flowId=flow-2",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.includes("/auth/flow/flow-2/bind")) {
        return Promise.resolve(new Response(JSON.stringify({
          status: "bound",
          bindingToken: "binding-token-2",
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
      if (url.endsWith("/bootstrap/client") && bootstrapCalls === 1) {
        bootstrapCalls += 1;
        return Promise.resolve(new Response(JSON.stringify({
          status: "ready",
          serverNow: 1_700_000_000,
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
          assertEquals(loginUrl, "https://trellis.example.com/_trellis/portal/users/login?flowId=flow-2");
          return { flowId: "flow-2" };
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

    assertEquals(fetchUrls.some((url) => url.endsWith("/auth/requests")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("connectClientWithDeps reauths when bootstrap reports contract_not_active", async () => {
  const originalFetch = globalThis.fetch;
  const fetchUrls: string[] = [];

  try {
    let bootstrapCalls = 0;
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = String(input);
      fetchUrls.push(url);
      if (url.endsWith("/bootstrap/client") && bootstrapCalls === 0) {
        bootstrapCalls += 1;
        return Promise.resolve(new Response(JSON.stringify({
          status: "not_ready",
          reason: "contract_not_active",
          serverNow: 1_700_000_000,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.endsWith("/auth/requests")) {
        return Promise.resolve(new Response(JSON.stringify({
          status: "flow_started",
          flowId: "flow-4",
          loginUrl: "https://trellis.example.com/_trellis/portal/users/login?flowId=flow-4",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.includes("/auth/flow/flow-4/bind")) {
        return Promise.resolve(new Response(JSON.stringify({
          status: "bound",
          bindingToken: "binding-token-4",
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
      if (url.endsWith("/bootstrap/client") && bootstrapCalls === 1) {
        bootstrapCalls += 1;
        return Promise.resolve(new Response(JSON.stringify({
          status: "ready",
          serverNow: 1_700_000_000,
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
          assertEquals(loginUrl, "https://trellis.example.com/_trellis/portal/users/login?flowId=flow-4");
          return { flowId: "flow-4" };
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

    assertEquals(fetchUrls.some((url) => url.endsWith("/auth/requests")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
