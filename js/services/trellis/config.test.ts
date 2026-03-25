import { assertEquals } from "@std/assert";

import { parseAuthConfigFromEnv } from "./config.ts";

Deno.test("auth config applies TTL overrides", () => {
  const cfg = parseAuthConfigFromEnv({
    SERVICE_NAME: "trellis",
    LOG_LEVEL: "info",
    AUTH_PORT: "3000",
    TRELLIS_SESSION_KEY_SEED:
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    AUTH_TTL_SESSIONS: "123",
    AUTH_TTL_OAUTH: "456",
    AUTH_TTL_PENDING_AUTH: "789",
    AUTH_TTL_BINDING_TOKENS_BUCKET: "321",
    AUTH_TTL_BINDING_TOKENS_INITIAL: "111",
    AUTH_TTL_BINDING_TOKENS_RENEW: "222",
    AUTH_TTL_CONNECTIONS: "654",
    AUTH_TTL_NATS_JWT: "987",
    AUTH_WEB_ORIGINS: "http://localhost:5173, https://app.example.com ,,",
	    NATS_SERVERS: "localhost",
	    NATS_AUTH_CREDS_FILE: "/tmp/auth.creds",
	    NATS_TRELLIS_CREDS_FILE: "/tmp/trellis.creds",
	    NATS_SENTINEL_CREDS: "/tmp/sentinel.creds",
	    NATS_AUTH_ISSUER_NKEY:
	      "AAAUZNB6EFNV5BTZEE3FUNQIZ2OFAD7NALJZ3RQY3TCOSFREMANAGSER",
    NATS_AUTH_ISSUER_SIGNING_SEED:
      "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    NATS_AUTH_TARGET_NKEY:
      "ADQCP2XPU3CAS2PLQKLSHQXWR64JEMOXLV53ABO7ERDTDV5QHJ4RUCSY",
    NATS_AUTH_TARGET_SIGNING_SEED:
      "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    NATS_AUTH_SXKEY_SEED:
      "SXAOLCT3V3T5EDXAY7KNSJJLN2JM4UVRXKOQPSZTGV27NE3PMHXFENGE4M",
    AUTH_REDIRECT: "https://auth.example.com/auth/callback",
    GITHUB_CLIENT_ID: "x",
    GITHUB_CLIENT_SECRET: "y",
  });

  assertEquals(cfg.ttlMs.sessions, 123);
  assertEquals(cfg.ttlMs.oauth, 456);
  assertEquals(cfg.ttlMs.pendingAuth, 789);
  assertEquals(cfg.ttlMs.bindingTokens.bucket, 321);
  assertEquals(cfg.ttlMs.bindingTokens.initial, 111);
  assertEquals(cfg.ttlMs.bindingTokens.renew, 222);
  assertEquals(cfg.ttlMs.connections, 654);
  assertEquals(cfg.ttlMs.natsJwt, 987);
  assertEquals(cfg.web.origins, [
    "http://localhost:5173",
    "https://app.example.com",
  ]);
});
