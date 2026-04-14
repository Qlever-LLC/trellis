import { assertEquals } from "@std/assert";

import { buildClientTransports } from "./transports.ts";
import type { Config } from "../config.ts";

function makeConfig(): Config {
  return {
    logLevel: "info",
    port: 3000,
    instanceName: "Trellis Auth",
    web: {
      origins: [],
      publicOrigin: "http://localhost:3000",
    },
    httpRateLimit: {
      windowMs: 60_000,
      max: 60,
    },
    ttlMs: {
      sessions: 86_400_000,
      oauth: 300_000,
      deviceHandoff: 1_800_000,
      pendingAuth: 300_000,
      bindingTokens: {
        bucket: 86_400_000,
        initial: 300_000,
        renew: 3_600_000,
        cliInitial: 86_400_000,
        cliRenew: 86_400_000,
      },
      connections: 7_200_000,
      natsJwt: 3_600_000,
    },
    nats: {
      servers: "nats://127.0.0.1:4222, localhost:4223",
      trellis: { credsPath: "/tmp/trellis.creds" },
      auth: { credsPath: "/tmp/auth.creds" },
      sentinelCredsPath: "/tmp/sentinel.creds",
      authCallout: {
        issuer: { nkey: "issuer", signing: "issuer-signing" },
        target: { nkey: "target", signing: "target-signing" },
        sxSeed: "sx-seed",
      },
    },
    sessionKeySeed: "session-seed",
    client: {
      natsServers: ["ws://localhost:8080", "wss://nats.example.com"],
    },
    oauth: {
      redirectBase: "http://localhost:3000/auth/callback",
      alwaysShowProviderChooser: false,
      providers: {},
    },
  };
}

Deno.test("buildClientTransports returns explicit native and websocket transports", () => {
  assertEquals(buildClientTransports(makeConfig()), {
    native: {
      natsServers: ["nats://127.0.0.1:4222", "localhost:4223"],
    },
    websocket: {
      natsServers: ["ws://localhost:8080", "wss://nats.example.com"],
    },
  });
});
