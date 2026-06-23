import { assertEquals } from "@std/assert";

import type { Config } from "../../config.ts";
import { GitHub } from "../providers/github.ts";
import { Provider } from "../providers/index.ts";
import type { UserSession } from "../schemas.ts";
import {
  buildProviderLogoutUrl,
  validateProviderLogoutReturnTo,
} from "./provider_logout.ts";

const BASE_CONFIG: Pick<Config, "web"> = {
  web: {
    origins: ["https://configured.example.com"],
    allowInsecureOrigins: [],
  },
};

function testUserSession(overrides: Partial<UserSession> = {}): UserSession {
  return {
    type: "user",
    userId: "usr_123",
    identity: {
      identityId: "idn_auth0_123",
      provider: "auth0",
      subject: "auth0|123",
    },
    email: "ada@example.com",
    name: "Ada",
    participantKind: "app",
    contractDigest: "digest-a",
    contractId: "trellis.console@v1",
    contractDisplayName: "Console",
    contractDescription: "Admin app",
    delegatedCapabilities: [],
    delegatedPublishSubjects: [],
    delegatedSubscribeSubjects: [],
    createdAt: new Date("2026-04-10T00:00:00.000Z"),
    lastAuth: new Date("2026-04-10T00:00:00.000Z"),
    ...overrides,
  };
}

class TestLogoutProvider extends Provider {
  override name = "auth0";
  override displayName = "Auth0";
  override issuer = "https://tenant.example.auth0.com";
  override authorizationEndpoint = "https://tenant.example.auth0.com/authorize";
  override tokenEndpoint = "https://tenant.example.auth0.com/oauth/token";
  override scope = "openid profile email";
  override supportsDiscovery = true;
  override supportsPKCE = true;
  calls: Array<{ returnTo?: string; federated?: boolean }> = [];

  constructor(private readonly logoutUrl: string | undefined) {
    super(
      "client-id",
      "client-secret",
      "https://trellis.example/auth/callback",
    );
  }

  buildLogoutUrl(args: {
    returnTo?: string;
    federated?: boolean;
  } = {}): Promise<string | undefined> {
    this.calls.push(args);
    return Promise.resolve(this.logoutUrl);
  }
}

Deno.test("provider logout returnTo accepts same-origin app URLs", () => {
  const session = testUserSession({
    app: { contractId: "app.example@v1", origin: "https://app.example.com" },
  });

  assertEquals(
    validateProviderLogoutReturnTo({
      returnTo: "https://app.example.com/signed-out?next=%2F",
      session,
      config: BASE_CONFIG,
    }),
    true,
  );
});

Deno.test("provider logout returnTo rejects cross-origin app URLs", () => {
  const session = testUserSession({
    app: { contractId: "app.example@v1", origin: "https://app.example.com" },
  });

  assertEquals(
    validateProviderLogoutReturnTo({
      returnTo: "https://evil.example.com/signed-out",
      session,
      config: BASE_CONFIG,
    }),
    false,
  );
});

Deno.test("provider logout returnTo accepts configured web origin fallback", () => {
  const session = testUserSession();

  assertEquals(
    validateProviderLogoutReturnTo({
      returnTo: "https://configured.example.com/signed-out",
      session,
      config: BASE_CONFIG,
    }),
    true,
  );
});

Deno.test("provider logout returnTo ignores wildcard web origins", () => {
  const session = testUserSession();

  assertEquals(
    validateProviderLogoutReturnTo({
      returnTo: "https://arbitrary.example.com/signed-out",
      session,
      config: { web: { origins: ["*"], allowInsecureOrigins: [] } },
    }),
    false,
  );
});

Deno.test("provider logout returnTo rejects malformed and non-http URLs", () => {
  const session = testUserSession();

  assertEquals(
    validateProviderLogoutReturnTo({
      returnTo: "not a url",
      session,
      config: BASE_CONFIG,
    }),
    false,
  );
  assertEquals(
    validateProviderLogoutReturnTo({
      returnTo: "javascript:alert(1)",
      session,
      config: BASE_CONFIG,
    }),
    false,
  );
});

Deno.test("provider logout builder returns OIDC provider URL when provider matches", async () => {
  const provider = new TestLogoutProvider(
    "https://tenant.example.auth0.com/v2/logout?client_id=client-id",
  );

  const result = await buildProviderLogoutUrl({
    provider,
    session: testUserSession(),
    returnTo: "https://configured.example.com/signed-out",
    config: BASE_CONFIG,
  });

  assertEquals(result, {
    ok: true,
    url: "https://tenant.example.auth0.com/v2/logout?client_id=client-id",
  });
  assertEquals(provider.calls, [{
    returnTo: "https://configured.example.com/signed-out",
    federated: undefined,
  }]);
});

Deno.test("provider logout builder returns undefined for mismatched, non-OIDC, and missing providers", async () => {
  const session = testUserSession();
  const mismatchedProvider = new TestLogoutProvider(
    "https://logout.example.com",
  );
  mismatchedProvider.name = "other";
  const githubProvider = new GitHub(
    "client-id",
    "client-secret",
    "https://trellis.example/auth/callback",
  );

  assertEquals(
    await buildProviderLogoutUrl({
      provider: mismatchedProvider,
      session,
      config: BASE_CONFIG,
    }),
    { ok: true },
  );
  assertEquals(
    await buildProviderLogoutUrl({
      provider: githubProvider,
      session: testUserSession({
        identity: {
          identityId: "idn_github_123",
          provider: "github",
          subject: "123",
        },
      }),
      config: BASE_CONFIG,
    }),
    { ok: true },
  );
  assertEquals(
    await buildProviderLogoutUrl({
      provider: undefined,
      session,
      config: BASE_CONFIG,
    }),
    { ok: true },
  );
  assertEquals(mismatchedProvider.calls, []);
});

Deno.test("provider logout builder passes federated flag to OIDC provider", async () => {
  const provider = new TestLogoutProvider(
    "https://tenant.example.auth0.com/v2/logout",
  );

  const result = await buildProviderLogoutUrl({
    provider,
    session: testUserSession(),
    federated: true,
    config: BASE_CONFIG,
  });

  assertEquals(result, {
    ok: true,
    url: "https://tenant.example.auth0.com/v2/logout",
  });
  assertEquals(provider.calls, [{ returnTo: undefined, federated: true }]);
});

Deno.test("provider logout builder reports invalid returnTo distinctly before provider construction", async () => {
  const provider = new TestLogoutProvider(
    "https://tenant.example.auth0.com/v2/logout",
  );

  const result = await buildProviderLogoutUrl({
    provider,
    session: testUserSession(),
    returnTo: "https://evil.example.com/signed-out",
    config: BASE_CONFIG,
  });

  assertEquals(result, { ok: false, error: "invalid_return_to" });
  assertEquals(provider.calls, []);
});
