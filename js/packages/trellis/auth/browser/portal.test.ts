import { assertEquals, assertRejects } from "@std/assert";

import {
  fetchPortalFlowState,
  portalFlowIdFromUrl,
  portalProviderLoginUrl,
  portalRedirectLocation,
  submitPortalApproval,
} from "./portal.ts";

Deno.test("portalFlowIdFromUrl reads flowId from URL", () => {
  assertEquals(portalFlowIdFromUrl(new URL("https://portal.example.com/login?flowId=flow-1")), "flow-1");
  assertEquals(portalFlowIdFromUrl(new URL("https://portal.example.com/login?redirectTo=%2F")), null);
});

Deno.test("portalProviderLoginUrl keeps flowId on provider links", () => {
  assertEquals(
    portalProviderLoginUrl({ authUrl: "https://auth.example.com/" }, "google", "flow-1"),
    "https://auth.example.com/auth/login/google?flowId=flow-1",
  );
});

Deno.test("portalRedirectLocation returns auth-owned redirect locations", () => {
  assertEquals(
    portalRedirectLocation({ status: "redirect", location: "https://app.example.com/callback?flowId=flow-1" }),
    "https://app.example.com/callback?flowId=flow-1",
  );
  assertEquals(portalRedirectLocation({ status: "expired" }), null);
});

Deno.test("fetchPortalFlowState returns auth-owned portal state directly", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input) => {
      assertEquals(String(input), "https://auth.example.com/auth/flow/flow-1");
      return new Response(JSON.stringify({
        status: "choose_provider",
        flowId: "flow-1",
        app: {
          contractId: "trellis.portal-app@v1",
          contractDigest: "digest",
          displayName: "Portal App",
          description: "User-facing auth portal",
        },
        providers: [
          { id: "github", displayName: "GitHub" },
          { id: "auth0", displayName: "Company SSO" },
        ],
      }));
    }) as typeof fetch;

    const flow = await fetchPortalFlowState({ authUrl: "https://auth.example.com" }, "flow-1");
    assertEquals(flow.status, "choose_provider");
    if (flow.status === "choose_provider") {
      assertEquals(flow.providers.length, 2);
      assertEquals(flow.app.displayName, "Portal App");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchPortalFlowState throws on non-success responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response("missing", { status: 404 })) as typeof fetch;

    await assertRejects(
      () => fetchPortalFlowState({ authUrl: "https://auth.example.com" }, "missing"),
      Error,
      "Failed to load portal flow (404)",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("submitPortalApproval posts decision and parses next state", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input, init) => {
      assertEquals(String(input), "https://auth.example.com/auth/flow/flow-1/approval");
      assertEquals(init?.method, "POST");
      assertEquals(init?.headers, { "content-type": "application/json" });
      assertEquals(String(init?.body), '{"decision":"approved"}');

      return new Response(JSON.stringify({
        status: "redirect",
        location: "https://app.example.com/callback?flowId=flow-1",
      }));
    }) as typeof fetch;

    const state = await submitPortalApproval({ authUrl: "https://auth.example.com/" }, "flow-1", "approved");
    assertEquals(state, {
      status: "redirect",
      location: "https://app.example.com/callback?flowId=flow-1",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
