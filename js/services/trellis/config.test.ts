import { assertEquals } from "@std/assert";

import { loadAuthConfigFromFile } from "./config.ts";

async function withTempConfig(
  configText: string,
  run: (configPath: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    const configPath = `${dir}/config.jsonc`;
    await Deno.writeTextFile(
      `${dir}/session.seed`,
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n",
    );
    await Deno.writeTextFile(
      `${dir}/issuer.seed`,
      "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n",
    );
    await Deno.writeTextFile(
      `${dir}/target.seed`,
      "SBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\n",
    );
    await Deno.writeTextFile(
      `${dir}/sx.seed`,
      "SXAOLCT3V3T5EDXAY7KNSJJLN2JM4UVRXKOQPSZTGV27NE3PMHXFENGE4M\n",
    );
    await Deno.writeTextFile(`${dir}/github.secret`, "github-secret\n");
    await Deno.writeTextFile(`${dir}/auth0.secret`, "auth0-secret\n");
    await Deno.writeTextFile(configPath, configText);
    await run(configPath);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("auth config loads structured provider map from file", async () => {
  await withTempConfig(
    `{
      // local browser origins
      "web": {
        "origins": ["http://127.0.0.1:5173", "https://app.example.com"],
        "publicOrigin": "http://127.0.0.1:3000"
      },
      "httpRateLimit": {
        "windowMs": 1234,
        "max": 55
      },
      "ttlMs": {
        "sessions": 123,
        "oauth": 456,
        "deviceFlow": 1800000,
        "pendingAuth": 789,
        "connections": 654,
        "natsJwt": 987
      },
      "nats": {
        "servers": "localhost",
        "auth": { "credsPath": "/tmp/auth.creds" },
        "trellis": { "credsPath": "/tmp/trellis.creds" },
        "sentinelCredsPath": "/tmp/sentinel.creds",
        "authCallout": {
          "issuer": {
            "nkey": "AAAUZNB6EFNV5BTZEE3FUNQIZ2OFAD7NALJZ3RQY3TCOSFREMANAGSER",
            "signingSeedFile": "./issuer.seed"
          },
          "target": {
            "nkey": "ADQCP2XPU3CAS2PLQKLSHQXWR64JEMOXLV53ABO7ERDTDV5QHJ4RUCSY",
            "signingSeedFile": "./target.seed"
          },
          "sxSeedFile": "./sx.seed"
        }
      },
      "sessionKeySeedFile": "./session.seed",
      "client": {
        "natsServers": ["ws://localhost:8080", "wss://nats.example.com"],
        "nativeNatsServers": ["tls://nats.example.com:4222"]
      },
      "oauth": {
        "redirectBase": "http://127.0.0.1:3000/auth/callback",
        "alwaysShowProviderChooser": true,
        "providers": {
          "github": {
            "type": "github",
            "clientId": "github-client",
            "clientSecretFile": "./github.secret"
          },
          "auth0": {
            "type": "oidc",
            "issuer": "https://tenant.example.auth0.com/",
            "clientId": "auth0-client",
            "clientSecretFile": "./auth0.secret",
            "displayName": "Company SSO",
            "scopes": ["openid", "profile", "email",]
          },
        },
      },
    }`,
    async (configPath) => {
      const cfg = await loadAuthConfigFromFile(configPath);

      assertEquals(cfg.port, 3000);
      assertEquals(cfg.web.origins, [
        "http://localhost:5173",
        "https://app.example.com",
      ]);
      assertEquals(cfg.web.publicOrigin, "http://localhost:3000");
      assertEquals(cfg.httpRateLimit.windowMs, 1234);
      assertEquals(cfg.httpRateLimit.max, 55);
      assertEquals(cfg.storage.dbPath, "/var/lib/trellis/trellis.sqlite");
      assertEquals(cfg.ttlMs.deviceFlow, 1800000);
      assertEquals(
        cfg.sessionKeySeed,
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      );
      assertEquals(cfg.client.natsServers, [
        "ws://localhost:8080",
        "wss://nats.example.com",
      ]);
      assertEquals(cfg.client.nativeNatsServers, [
        "tls://nats.example.com:4222",
      ]);
      assertEquals(
        cfg.nats.authCallout.issuer.signing,
        "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      );
      assertEquals(
        cfg.oauth.redirectBase,
        "http://localhost:3000/auth/callback",
      );
      assertEquals(cfg.oauth.alwaysShowProviderChooser, true);
      assertEquals(cfg.oauth.providers.github.type, "github");
      assertEquals(cfg.oauth.providers.github.clientSecret, "github-secret");
      assertEquals(cfg.oauth.providers.github.displayName, "GitHub");
      assertEquals(cfg.oauth.providers.auth0.type, "oidc");
      assertEquals(cfg.oauth.providers.auth0.clientSecret, "auth0-secret");
      assertEquals(cfg.oauth.providers.auth0.displayName, "Company SSO");
      if (cfg.oauth.providers.auth0.type !== "oidc") {
        throw new Error("expected auth0 to be configured as oidc");
      }
      assertEquals(cfg.oauth.providers.auth0.scopes, [
        "openid",
        "profile",
        "email",
      ]);
    },
  );
});

Deno.test("auth config loads explicit storage database path", async () => {
  await withTempConfig(
    `{
      "storage": {
        "dbPath": "/tmp/custom-trellis.sqlite"
      },
      "nats": {
        "servers": "localhost",
        "auth": { "credsPath": "/tmp/auth.creds" },
        "trellis": { "credsPath": "/tmp/trellis.creds" },
        "sentinelCredsPath": "/tmp/sentinel.creds",
        "authCallout": {
          "issuer": {
            "nkey": "AAAUZNB6EFNV5BTZEE3FUNQIZ2OFAD7NALJZ3RQY3TCOSFREMANAGSER",
            "signingSeedFile": "./issuer.seed"
          },
          "target": {
            "nkey": "ADQCP2XPU3CAS2PLQKLSHQXWR64JEMOXLV53ABO7ERDTDV5QHJ4RUCSY",
            "signingSeedFile": "./target.seed"
          },
          "sxSeedFile": "./sx.seed"
        }
      },
      "sessionKeySeedFile": "./session.seed",
      "client": {
        "natsServers": ["ws://localhost:8080"]
      },
      "oauth": {
        "redirectBase": "http://localhost:3000/auth/callback",
        "providers": {
          "github": {
            "type": "github",
            "clientId": "github-client",
            "clientSecretFile": "./github.secret"
          }
        }
      }
    }`,
    async (configPath) => {
      const cfg = await loadAuthConfigFromFile(configPath);
      assertEquals(cfg.storage.dbPath, "/tmp/custom-trellis.sqlite");
    },
  );
});

Deno.test("auth config defaults device flow TTL to thirty minutes", async () => {
  await withTempConfig(
    `{
      "web": { "origins": ["http://localhost:5173"] },
      "nats": {
        "servers": "localhost",
        "auth": { "credsPath": "/tmp/auth.creds" },
        "trellis": { "credsPath": "/tmp/trellis.creds" },
        "sentinelCredsPath": "/tmp/sentinel.creds",
        "authCallout": {
          "issuer": {
            "nkey": "AAAUZNB6EFNV5BTZEE3FUNQIZ2OFAD7NALJZ3RQY3TCOSFREMANAGSER",
            "signingSeedFile": "./issuer.seed"
          },
          "target": {
            "nkey": "ADQCP2XPU3CAS2PLQKLSHQXWR64JEMOXLV53ABO7ERDTDV5QHJ4RUCSY",
            "signingSeedFile": "./target.seed"
          },
          "sxSeedFile": "./sx.seed"
        }
      },
      "sessionKeySeedFile": "./session.seed",
      "client": {
        "natsServers": ["ws://localhost:8080"]
      },
      "oauth": {
        "redirectBase": "http://localhost:3000/auth/callback",
        "providers": {
          "github": {
            "type": "github",
            "clientId": "github-client",
            "clientSecretFile": "./github.secret"
          }
        }
      }
    }`,
    async (configPath) => {
      const cfg = await loadAuthConfigFromFile(configPath);
      assertEquals(cfg.ttlMs.oauth, 5 * 60_000);
      assertEquals(cfg.ttlMs.deviceFlow, 30 * 60_000);
    },
  );
});

Deno.test("auth config defaults web origins to wildcard", async () => {
  await withTempConfig(
    `{
      "nats": {
        "servers": "localhost",
        "auth": { "credsPath": "/tmp/auth.creds" },
        "trellis": { "credsPath": "/tmp/trellis.creds" },
        "sentinelCredsPath": "/tmp/sentinel.creds",
        "authCallout": {
          "issuer": {
            "nkey": "AAAUZNB6EFNV5BTZEE3FUNQIZ2OFAD7NALJZ3RQY3TCOSFREMANAGSER",
            "signingSeedFile": "./issuer.seed"
          },
          "target": {
            "nkey": "ADQCP2XPU3CAS2PLQKLSHQXWR64JEMOXLV53ABO7ERDTDV5QHJ4RUCSY",
            "signingSeedFile": "./target.seed"
          },
          "sxSeedFile": "./sx.seed"
        }
      },
      "sessionKeySeedFile": "./session.seed",
      "client": {
        "natsServers": ["ws://localhost:8080"]
      },
      "oauth": {
        "redirectBase": "http://localhost:3000/auth/callback",
        "providers": {
          "github": {
            "type": "github",
            "clientId": "github-client",
            "clientSecretFile": "./github.secret"
          }
        }
      }
    }`,
    async (configPath) => {
      const cfg = await loadAuthConfigFromFile(configPath);
      assertEquals(cfg.web.origins, ["*"]);
      assertEquals(cfg.web.allowInsecureOrigins, []);
    },
  );
});

Deno.test("auth config loads explicit insecure origin allowlist", async () => {
  await withTempConfig(
    `{
      "web": {
        "origins": ["http://portal.internal:5173"],
        "allowInsecureOrigins": [
          "http://portal.internal:3000",
          "http://127.0.0.1:3000",
          "http://portal.internal:3000"
        ]
      },
      "nats": {
        "servers": "localhost",
        "auth": { "credsPath": "/tmp/auth.creds" },
        "trellis": { "credsPath": "/tmp/trellis.creds" },
        "sentinelCredsPath": "/tmp/sentinel.creds",
        "authCallout": {
          "issuer": {
            "nkey": "AAAUZNB6EFNV5BTZEE3FUNQIZ2OFAD7NALJZ3RQY3TCOSFREMANAGSER",
            "signingSeedFile": "./issuer.seed"
          },
          "target": {
            "nkey": "ADQCP2XPU3CAS2PLQKLSHQXWR64JEMOXLV53ABO7ERDTDV5QHJ4RUCSY",
            "signingSeedFile": "./target.seed"
          },
          "sxSeedFile": "./sx.seed"
        }
      },
      "sessionKeySeedFile": "./session.seed",
      "client": {
        "natsServers": ["ws://localhost:8080"]
      },
      "oauth": {
        "redirectBase": "http://portal.internal:3000/auth/callback",
        "providers": {
          "github": {
            "type": "github",
            "clientId": "github-client",
            "clientSecretFile": "./github.secret"
          }
        }
      }
    }`,
    async (configPath) => {
      const cfg = await loadAuthConfigFromFile(configPath);
      assertEquals(cfg.web.allowInsecureOrigins, [
        "http://portal.internal:3000",
        "http://localhost:3000",
      ]);
    },
  );
});

Deno.test("auth config preserves explicit wildcard web origins", async () => {
  await withTempConfig(
    `{
      "web": {
        "origins": ["*", "http://127.0.0.1:5173"]
      },
      "nats": {
        "servers": "localhost",
        "auth": { "credsPath": "/tmp/auth.creds" },
        "trellis": { "credsPath": "/tmp/trellis.creds" },
        "sentinelCredsPath": "/tmp/sentinel.creds",
        "authCallout": {
          "issuer": {
            "nkey": "AAAUZNB6EFNV5BTZEE3FUNQIZ2OFAD7NALJZ3RQY3TCOSFREMANAGSER",
            "signingSeedFile": "./issuer.seed"
          },
          "target": {
            "nkey": "ADQCP2XPU3CAS2PLQKLSHQXWR64JEMOXLV53ABO7ERDTDV5QHJ4RUCSY",
            "signingSeedFile": "./target.seed"
          },
          "sxSeedFile": "./sx.seed"
        }
      },
      "sessionKeySeedFile": "./session.seed",
      "client": {
        "natsServers": ["ws://localhost:8080"]
      },
      "oauth": {
        "redirectBase": "http://localhost:3000/auth/callback",
        "providers": {
          "github": {
            "type": "github",
            "clientId": "github-client",
            "clientSecretFile": "./github.secret"
          }
        }
      }
    }`,
    async (configPath) => {
      const cfg = await loadAuthConfigFromFile(configPath);
      assertEquals(cfg.web.origins, ["*"]);
    },
  );
});

Deno.test("auth config defaults provider chooser preference to false", async () => {
  await withTempConfig(
    `{
      "web": { "origins": ["http://localhost:5173"] },
      "nats": {
        "servers": "localhost",
        "auth": { "credsPath": "/tmp/auth.creds" },
        "trellis": { "credsPath": "/tmp/trellis.creds" },
        "sentinelCredsPath": "/tmp/sentinel.creds",
        "authCallout": {
          "issuer": {
            "nkey": "AAAUZNB6EFNV5BTZEE3FUNQIZ2OFAD7NALJZ3RQY3TCOSFREMANAGSER",
            "signingSeedFile": "./issuer.seed"
          },
          "target": {
            "nkey": "ADQCP2XPU3CAS2PLQKLSHQXWR64JEMOXLV53ABO7ERDTDV5QHJ4RUCSY",
            "signingSeedFile": "./target.seed"
          },
          "sxSeedFile": "./sx.seed"
        }
      },
      "sessionKeySeedFile": "./session.seed",
      "client": {
        "natsServers": ["ws://localhost:8080"]
      },
      "oauth": {
        "redirectBase": "http://localhost:3000/auth/callback",
        "providers": {
          "github": {
            "type": "github",
            "clientId": "github-client",
            "clientSecretFile": "./github.secret"
          }
        }
      }
    }`,
    async (configPath) => {
      const cfg = await loadAuthConfigFromFile(configPath);
      assertEquals(cfg.oauth.alwaysShowProviderChooser, false);
    },
  );
});
