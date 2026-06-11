import { assertEquals } from "@std/assert";

import { OAuth2CodeRequest } from "./oauth.ts";
import { OAuth2Provider } from "./providers/index.ts";
import type { OAuth2User } from "./providers/oauth2_user.ts";

class TestOAuthProvider extends OAuth2Provider {
  override name = "auth0";
  override displayName = "Company SSO";
  override issuer = "https://tenant.example.auth0.com";
  override authorizationEndpoint = "https://tenant.example.auth0.com/authorize";
  override tokenEndpoint = "https://tenant.example.auth0.com/oauth/token";
  override scope = "openid profile email";
  override supportsDiscovery = false;
  override supportsPKCE = true;

  constructor(organization?: string) {
    super(
      "client-id",
      "client-secret",
      "https://trellis.example/auth/callback",
    );
    this.organization = organization;
  }

  override getUserInfo(_token: string): Promise<OAuth2User> {
    throw new Error("not used");
  }
}

Deno.test("OAuth2CodeRequest includes configured organization", async () => {
  const provider = new TestOAuthProvider("org_krishi");

  const [redirectUrl] = await OAuth2CodeRequest(provider);
  const url = new URL(redirectUrl);

  assertEquals(url.origin + url.pathname, provider.authorizationEndpoint);
  assertEquals(url.searchParams.get("client_id"), "client-id");
  assertEquals(
    url.searchParams.get("redirect_uri"),
    "https://trellis.example/auth/callback/auth0",
  );
  assertEquals(url.searchParams.get("organization"), "org_krishi");
});

Deno.test("OAuth2CodeRequest omits organization when unconfigured", async () => {
  const provider = new TestOAuthProvider();

  const [redirectUrl] = await OAuth2CodeRequest(provider);
  const url = new URL(redirectUrl);

  assertEquals(url.searchParams.has("organization"), false);
});
