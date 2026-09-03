import { assertEquals, assertRejects } from "@std/assert";

import {
  fetchPortalFlowState,
  portalFlowIdFromUrl,
  portalProviderLoginUrl,
  portalRedirectLocation,
  submitPortalApproval,
} from "./portal.ts";

const binding = { secret: "portal-secret", digest: "portal-digest" };

Deno.test("portalFlowIdFromUrl reads flowId from URL", () => {
  assertEquals(
    portalFlowIdFromUrl(
      new URL("https://portal.example.com/login?flowId=flow-1"),
    ),
    "flow-1",
  );
  assertEquals(
    portalFlowIdFromUrl(
      new URL("https://portal.example.com/login?redirectTo=%2F"),
    ),
    null,
  );
});

Deno.test("portalProviderLoginUrl keeps flowId on provider links", () => {
  assertEquals(
    portalProviderLoginUrl(
      { authUrl: "https://auth.example.com/" },
      "google",
      "flow-1",
      binding,
    ),
    "https://auth.example.com/auth/login/google?flowId=flow-1&portalBindingDigest=portal-digest",
  );
});

Deno.test("portalRedirectLocation returns auth-owned redirect locations", () => {
  assertEquals(
    portalRedirectLocation({
      status: "redirect",
      location: "https://app.example.com/callback?flowId=flow-1",
    }),
    "https://app.example.com/callback?flowId=flow-1",
  );
  assertEquals(
    portalRedirectLocation({
      status: "approval_denied",
      flowId: "flow-1",
      approval: {
        contractId: "trellis-app.console@v1",
        contractDigest: "digest",
        displayName: "Trellis Console",
        description: "Admin console",
        capabilities: {},
      },
      returnLocation:
        "https://app.example.com/callback?authError=approval_denied",
    }),
    "https://app.example.com/callback?authError=approval_denied",
  );
  assertEquals(portalRedirectLocation({ status: "expired" }), null);
  assertEquals(
    portalRedirectLocation({
      status: "expired",
      returnLocation: "https://app.example.com/callback",
    }),
    "https://app.example.com/callback",
  );
});

Deno.test("fetchPortalFlowState returns auth-owned portal state directly", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input) => {
      assertEquals(String(input), "https://auth.example.com/auth/flow/flow-1");
      return new Response(JSON.stringify({
        flowId: "flow-1",
        expiresAt: 2_000_000_000_000,
        state: "choose_provider",
        providers: ["github", "auth0"],
        registrationEnabled: false,
        federatedRegistrationEnabled: false,
        futureTopLevelHint: true,
        consentView: {
          participant: {
            id: "trellis.portal-app@v1",
            digest: "digest",
            displayName: "Portal App",
            description: "User-facing auth portal",
            futureParticipantField: 1,
          },
          required: { permissions: [], capabilities: [] },
          optionalBundles: [],
        },
      }));
    }) as typeof fetch;

    const flow = await fetchPortalFlowState(
      {
        authUrl: "https://auth.example.com",
      },
      "flow-1",
      binding,
    );
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
    globalThis.fetch = (async () =>
      Response.json({ error: { code: "flow_not_found" } }, {
        status: 404,
      })) as typeof fetch;

    await assertRejects(
      () =>
        fetchPortalFlowState(
          { authUrl: "https://auth.example.com" },
          "missing",
          binding,
        ),
      Error,
      "Trellis HTTP 404: flow_not_found",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("submitPortalApproval posts decision and parses next state", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let call = 0;
    globalThis.fetch = (async (input, init) => {
      call += 1;
      if (call <= 2) {
        return new Response(JSON.stringify({
          flowId: "flow-1",
          expiresAt: 2_000_000_000_000,
          state: "approval_required",
          providers: ["local"],
          registrationEnabled: false,
          federatedRegistrationEnabled: false,
          ...(call === 2 ? { consentViewDigest: "consent-digest" } : {}),
          consentView: {
            participant: {
              id: "trellis-app.console@v1",
              digest: "digest",
              displayName: "Trellis Console",
              description: "Admin console",
            },
            required: { permissions: [], capabilities: [] },
            optionalBundles: [],
          },
          ...(call === 2
            ? {
              user: {
                origin: "trellis",
                id: "usr-1",
                name: "Admin",
              },
            }
            : {}),
          redirectTarget:
            "https://app.example.com/callback?portalCallback=token",
        }));
      }
      assertEquals(
        String(input),
        "https://auth.example.com/auth/flow/flow-1/approval",
      );
      assertEquals(init?.method, "POST");
      assertEquals(init?.headers, {
        "content-type": "application/json",
        "trellis-portal-binding": binding.secret,
      });
      const body = JSON.parse(String(init?.body));
      assertEquals(body.approved, true);
      assertEquals(body.consentViewDigest, "consent-digest");
      assertEquals(body.selectedOptionalBundles, []);
      assertEquals(body.idempotencyKey, undefined);

      return new Response(JSON.stringify({
        flowId: "flow-1",
        expiresAt: 2_000_000_000_000,
        state: "approved",
        providers: [],
        registrationEnabled: false,
        federatedRegistrationEnabled: false,
        consentViewDigest: "consent-digest",
        consentView: {
          participant: {
            id: "trellis-app.console@v1",
            digest: "digest",
            displayName: "Trellis Console",
            description: "Admin console",
          },
          required: { permissions: [], capabilities: [] },
          optionalBundles: [],
        },
        user: { origin: "trellis", id: "usr-1", name: "Admin" },
        redirectTarget: "https://app.example.com/callback?portalCallback=token",
      }));
    }) as typeof fetch;

    const state = await submitPortalApproval(
      { authUrl: "https://auth.example.com/" },
      "flow-1",
      binding,
      "approved",
    );
    assertEquals(state, {
      status: "redirect",
      location:
        "https://app.example.com/callback?portalCallback=token&flowId=flow-1",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
