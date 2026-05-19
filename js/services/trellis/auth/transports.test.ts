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
      cors: { mode: "restricted", origins: [], credentials: true },
      publicOrigin: "http://localhost:3000",
      allowInsecureOrigins: [],
    },
    httpRateLimit: {
      windowMs: 60_000,
      max: 60,
    },
    auth: {
      localIdentity: {
        enabled: true,
        passwordPolicy: { minLength: 12 },
      },
    },
    storage: {
      dbPath: "/tmp/trellis.sqlite",
    },
    ttlMs: {
      sessions: 86_400_000,
      oauth: 300_000,
      deviceFlow: 1_800_000,
      pendingAuth: 300_000,
      connections: 7_200_000,
      natsJwt: 3_600_000,
    },
    nats: {
      servers: "nats://127.0.0.1:4222, localhost:4223",
      jetstream: { replicas: 1 },
      trellis: { credsPath: "/tmp/trellis.creds" },
      auth: { credsPath: "/tmp/auth.creds" },
      system: { credsPath: "/tmp/system.creds" },
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

Deno.test("buildClientTransports prefers configured native client endpoints", () => {
  const config = makeConfig();
  config.client.nativeNatsServers = [
    "tls://nats.example.com:4222",
    "tls://backup.example.com:4222",
  ];

  assertEquals(buildClientTransports(config), {
    native: {
      natsServers: [
        "tls://nats.example.com:4222",
        "tls://backup.example.com:4222",
      ],
    },
    websocket: {
      natsServers: ["ws://localhost:8080", "wss://nats.example.com"],
    },
  });
});
