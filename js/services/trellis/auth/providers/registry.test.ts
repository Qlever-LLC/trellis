import { assertEquals, assertInstanceOf } from "@std/assert";

import { __testing__ as configTesting, type Config } from "../../config.ts";
import { GitHub } from "./github.ts";
import { OIDC } from "./oidc.ts";
import { createProviders } from "./registry.ts";

function createConfig(): Config {
  return {
    logLevel: "info",
    port: 3000,
    instanceName: "Trellis Auth",
    web: {
      origins: ["http://localhost:5173"],
      publicOrigin: "http://localhost:3000",
      allowInsecureOrigins: [],
    },
    httpRateLimit: {
      windowMs: 60_000,
      max: 60,
    },
    storage: {
      dbPath: "/tmp/trellis.sqlite",
    },
    ttlMs: {
      sessions: 1,
      oauth: 2,
      deviceFlow: 3,
      pendingAuth: 3,
      connections: 7,
      natsJwt: 9,
    },
    nats: {
      servers: "localhost",
      trellis: { credsPath: "/tmp/trellis.creds" },
      auth: { credsPath: "/tmp/auth.creds" },
      sentinelCredsPath: "/tmp/sentinel.creds",
      authCallout: {
        issuer: { nkey: "issuer", signing: "issuer-seed" },
        target: { nkey: "target", signing: "target-seed" },
        sxSeed: "sx-seed",
      },
    },
    sessionKeySeed: "session-seed",
    client: {
      natsServers: ["ws://localhost:8080"],
    },
    oauth: {
      redirectBase: "http://localhost:3000/auth/callback",
      alwaysShowProviderChooser: false,
      providers: {
        github: {
          type: "github",
          clientId: "github-client",
          clientSecret: "github-secret",
          displayName: "GitHub",
        },
        auth0: {
          type: "oidc",
          issuer: "https://tenant.example.auth0.com/",
          clientId: "auth0-client",
          clientSecret: "auth0-secret",
          displayName: "Company SSO",
          scopes: ["openid", "profile", "email"],
        },
      },
    },
  };
}

Deno.test("createProviders builds configured GitHub and OIDC providers", () => {
  const config = createConfig();
  configTesting.setConfig(config);
  try {
    const providers = createProviders(config);

    assertInstanceOf(providers.github, GitHub);
    assertInstanceOf(providers.auth0, OIDC);
    assertEquals(providers.github.displayName, "GitHub");
    assertEquals(providers.auth0.displayName, "Company SSO");
    assertEquals(
      providers.auth0.getRedirectUri(),
      "http://localhost:3000/auth/callback/auth0",
    );
  } finally {
    configTesting.resetConfig();
  }
});
