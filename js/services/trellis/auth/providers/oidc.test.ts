import { assertEquals } from "@std/assert";

import { __testing__, OIDC } from "./oidc.ts";

function createProvider(opts: {
  logout?: {
    enabled: boolean;
    endpoint?: string;
    mode: "oidc" | "auth0";
    allowFederated: boolean;
  };
} = {}): OIDC {
  return new OIDC({
    name: "auth0",
    displayName: "Company SSO",
    issuer: "https://tenant.example.auth0.com/",
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectBase: "https://trellis.example/auth/callback",
    scopes: ["openid", "deployment", "email"],
    logout: opts.logout,
  });
}

Deno.test("OIDC provider maps userinfo claims using sub as stable id", async () => {
  const provider = createProvider();

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

Deno.test("OIDC provider discovers end_session_endpoint for logout URLs", async () => {
  const provider = createProvider({
    logout: {
      enabled: true,
      mode: "oidc",
      allowFederated: false,
    },
  });
  const restore = __testing__.setFetch(
    async (input: Request | URL | string) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : input.url;
      assertEquals(
        url,
        "https://tenant.example.auth0.com/.well-known/openid-configuration",
      );
      return new Response(
        JSON.stringify({
          end_session_endpoint: "https://tenant.example.auth0.com/oidc/logout",
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  );

  try {
    const logoutUrl = await provider.buildLogoutUrl({
      returnTo: "https://app.example.com/signed-out",
    });
    const url = new URL(logoutUrl ?? "");

    assertEquals(
      url.origin + url.pathname,
      "https://tenant.example.auth0.com/oidc/logout",
    );
    assertEquals(url.searchParams.get("client_id"), "client-id");
    assertEquals(
      url.searchParams.get("post_logout_redirect_uri"),
      "https://app.example.com/signed-out",
    );
  } finally {
    restore();
  }
});

Deno.test("OIDC provider builds Auth0 logout URL from issuer fallback", async () => {
  const provider = createProvider({
    logout: {
      enabled: true,
      mode: "auth0",
      allowFederated: false,
    },
  });

  const logoutUrl = await provider.buildLogoutUrl({
    returnTo: "https://app.example.com/signed-out",
  });
  const url = new URL(logoutUrl ?? "");

  assertEquals(
    url.origin + url.pathname,
    "https://tenant.example.auth0.com/v2/logout",
  );
  assertEquals(url.searchParams.get("client_id"), "client-id");
  assertEquals(
    url.searchParams.get("returnTo"),
    "https://app.example.com/signed-out",
  );
});

Deno.test("OIDC provider uses explicit logout endpoint", async () => {
  const provider = createProvider({
    logout: {
      enabled: true,
      endpoint: "https://login.example.com/logout",
      mode: "oidc",
      allowFederated: false,
    },
  });

  const logoutUrl = await provider.buildLogoutUrl();
  const url = new URL(logoutUrl ?? "");

  assertEquals(url.origin + url.pathname, "https://login.example.com/logout");
  assertEquals(url.searchParams.get("client_id"), "client-id");
});

Deno.test("OIDC provider returns undefined when logout is disabled", async () => {
  const provider = createProvider({
    logout: {
      enabled: false,
      endpoint: "https://login.example.com/logout",
      mode: "oidc",
      allowFederated: false,
    },
  });

  assertEquals(await provider.getEndSessionEndpoint(), undefined);
  assertEquals(await provider.buildLogoutUrl(), undefined);
});

Deno.test("OIDC provider only includes Auth0 federated logout when allowed", async () => {
  const deniedProvider = createProvider({
    logout: {
      enabled: true,
      mode: "auth0",
      allowFederated: false,
    },
  });
  const allowedProvider = createProvider({
    logout: {
      enabled: true,
      mode: "auth0",
      allowFederated: true,
    },
  });

  const deniedUrl = new URL(
    await deniedProvider.buildLogoutUrl({ federated: true }) ?? "",
  );
  const allowedUrl = new URL(
    await allowedProvider.buildLogoutUrl({ federated: true }) ?? "",
  );

  assertEquals(deniedUrl.searchParams.has("federated"), false);
  assertEquals(allowedUrl.searchParams.has("federated"), true);
});
