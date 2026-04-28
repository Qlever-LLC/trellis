import { assertEquals } from "@std/assert";

import { __testing__, OIDC } from "./oidc.ts";

Deno.test("OIDC provider maps userinfo claims using sub as stable id", async () => {
  const provider = new OIDC({
    name: "auth0",
    displayName: "Company SSO",
    issuer: "https://tenant.example.auth0.com/",
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectBase: "https://trellis.example/auth/callback",
    scopes: ["openid", "deployment", "email"],
  });

  const restore = __testing__.setFetch(
    async (input: Request | URL | string, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : input.url;
      if (url.endsWith("/.well-known/openid-configuration")) {
        return new Response(
          JSON.stringify({
            issuer: "https://tenant.example.auth0.com/",
            authorization_endpoint:
              "https://tenant.example.auth0.com/authorize",
            token_endpoint: "https://tenant.example.auth0.com/oauth/token",
            userinfo_endpoint: "https://tenant.example.auth0.com/userinfo",
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      assertEquals(url, "https://tenant.example.auth0.com/userinfo");
      const authorization = init?.headers instanceof Headers
        ? init.headers.get("authorization")
        : init?.headers && !Array.isArray(init.headers)
        ? (init.headers as Record<string, string>)["authorization"]
        : undefined;
      assertEquals(authorization, "Bearer access-token");
      return new Response(
        JSON.stringify({
          sub: "auth0|abc123",
          name: "Ada Lovelace",
          email: "ada@example.com",
          email_verified: true,
          picture: "https://example.com/avatar.png",
          updated_at: "2026-03-26T00:00:00Z",
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  );

  try {
    const user = await provider.getUserInfo("access-token");
    assertEquals(user.provider, "auth0");
    assertEquals(user.id, "auth0|abc123");
    assertEquals(user.name, "Ada Lovelace");
    assertEquals(user.email, "ada@example.com");
    assertEquals(user.emailVerified, true);
    assertEquals(user.picture, "https://example.com/avatar.png");
  } finally {
    restore();
  }
});
