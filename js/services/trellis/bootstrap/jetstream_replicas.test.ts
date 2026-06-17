import { assertEquals } from "@std/assert";

import type { Config } from "../config.ts";
import {
  type JetStreamTopologyRequester,
  resolveJetStreamReplicaCount,
} from "./jetstream_replicas.ts";

function testConfig(replicas?: number): Config {
  return {
    logLevel: "info",
    port: 3000,
    instanceName: "Trellis",
    web: {
      origins: ["*"],
      allowInsecureOrigins: [],
    },
    httpRateLimit: {
      windowMs: 60_000,
      max: 60,
    },
    storage: {
      dbPath: "/tmp/trellis.sqlite",
    },
    auth: {
      localIdentity: {
        enabled: true,
        passwordPolicy: {
          minLength: 12,
        },
        passwordHashing: { profile: "default" },
      },
    },
    ttlMs: {
      sessions: 24 * 60 * 60_000,
      oauth: 5 * 60_000,
      deviceFlow: 30 * 60_000,
      pendingAuth: 5 * 60_000,
      connections: 2 * 60 * 60_000,
      natsJwt: 60 * 60_000,
    },
    nats: {
      servers: "localhost",
      jetstream: replicas === undefined ? {} : { replicas },
      trellis: { credsPath: "/tmp/trellis.creds" },
      auth: { credsPath: "/tmp/auth.creds" },
      system: { credsPath: "/tmp/system.creds" },
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
      providers: {},
    },
  };
}

function logger() {
  const warnings: Array<{ fields: Record<string, unknown>; message: string }> =
    [];
  return {
    warnings,
    logger: {
      warn(fields: Record<string, unknown>, message: string) {
        warnings.push({ fields, message });
      },
    },
  };
}

function requester(response: unknown): JetStreamTopologyRequester {
  return {
    async request(subject) {
      assertEquals(subject, "$SYS.REQ.SERVER.PING.JSZ");
      return {
        data: new TextEncoder().encode(JSON.stringify(response)),
      };
    },
  };
}

Deno.test("JetStream replica resolution honors explicit config", async () => {
  const calls: string[] = [];
  const { logger: testLogger } = logger();
  const replicas = await resolveJetStreamReplicaCount(
    testConfig(2),
    {
      async request(subject) {
        calls.push(subject);
        return { data: new Uint8Array() };
      },
    },
    testLogger,
  );

  assertEquals(replicas, 2);
  assertEquals(calls, []);
});

Deno.test("JetStream replica resolution uses 3 for sufficient clustered peers", async () => {
  const { logger: testLogger, warnings } = logger();
  const replicas = await resolveJetStreamReplicaCount(
    testConfig(),
    requester({
      meta_cluster: {
        replicas: [
          { name: "n1", current: true },
          { name: "n2", current: true },
          { name: "n3", current: true },
        ],
      },
    }),
    testLogger,
  );

  assertEquals(replicas, 3);
  assertEquals(warnings, []);
});

Deno.test("JetStream replica resolution uses 1 without sufficient peers", async () => {
  const { logger: testLogger, warnings } = logger();
  const replicas = await resolveJetStreamReplicaCount(
    testConfig(),
    requester({
      meta_cluster: {
        replicas: [
          { name: "n1", current: true },
          { name: "n2", current: false },
          { name: "n3", current: true },
        ],
      },
    }),
    testLogger,
  );

  assertEquals(replicas, 1);
  assertEquals(warnings, []);
});

Deno.test("JetStream replica resolution falls back to 1 when probing fails", async () => {
  const { logger: testLogger, warnings } = logger();
  const replicas = await resolveJetStreamReplicaCount(
    testConfig(),
    {
      request() {
        return Promise.reject(new Error("no permission"));
      },
    },
    testLogger,
  );

  assertEquals(replicas, 1);
  assertEquals(warnings.length, 1);
});
