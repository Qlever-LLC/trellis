import { deepEqual, equal } from "node:assert/strict";

import {
  describeSessionPrincipal,
  describeUserGrant,
  formatShortKey,
  participantKindLabel,
} from "./auth_display.ts";

Deno.test("describeSessionPrincipal renders explicit user app and agent metadata", () => {
  deepEqual(
    describeSessionPrincipal({
      key: "github.123.sk_app",
      sessionKey: "sk_app",
      participantKind: "app",
      principal: {
        type: "user",
        trellisId: "user_123",
        origin: "github",
        id: "123",
        name: "Ada Lovelace",
      },
      contractId: "trellis.console@v1",
      contractDisplayName: "Trellis Console",
      createdAt: "2026-04-10T00:00:00.000Z",
      lastAuth: "2026-04-10T01:00:00.000Z",
    }),
    {
      title: "Ada Lovelace",
      details: "github.123 • Trellis Console (trellis.console@v1)",
    },
  );

  deepEqual(
    describeSessionPrincipal({
      key: "github.123.sk_agent",
      sessionKey: "sk_agent",
      participantKind: "agent",
      principal: {
        type: "user",
        trellisId: "user_123",
        origin: "github",
        id: "123",
        name: "",
      },
      contractId: "trellis.agent@v1",
      contractDisplayName: "Trellis Agent",
      createdAt: "2026-04-10T00:00:00.000Z",
      lastAuth: "2026-04-10T01:00:00.000Z",
    }),
    {
      title: "github.123",
      details: "Trellis Agent (trellis.agent@v1)",
    },
  );
});

Deno.test("describeSessionPrincipal renders device and service metadata without key parsing", () => {
  deepEqual(
    describeSessionPrincipal({
      key: "dev_1.pub.sk_device",
      sessionKey: "sk_device",
      participantKind: "device",
      principal: {
        type: "device",
        deviceId: "dev_1",
        deviceType: "ios",
        runtimePublicKey: "PUB",
        deploymentId: "ios.mobile",
      },
      contractId: "device.contract@v1",
      contractDisplayName: "Device Runtime",
      createdAt: "2026-04-10T00:00:00.000Z",
      lastAuth: "2026-04-10T01:00:00.000Z",
    }),
    {
      title: "dev_1",
      details: "ios • ios.mobile • Device Runtime (device.contract@v1)",
    },
  );

  deepEqual(
    describeSessionPrincipal({
      key: "service.billing.sk_service",
      sessionKey: "sk_service",
      participantKind: "service",
      principal: {
        type: "service",
        id: "billing",
        name: "Billing Service",
        instanceId: "svc_123",
        deploymentId: "billing.default",
      },
      createdAt: "2026-04-10T00:00:00.000Z",
      lastAuth: "2026-04-10T01:00:00.000Z",
    }),
    {
      title: "Billing Service",
      details: "billing • billing.default • svc_123",
    },
  );
});

Deno.test("grant helpers expose honest participant labels and compact keys", () => {
  equal(participantKindLabel("app"), "App");
  equal(participantKindLabel("agent"), "Agent");
  equal(participantKindLabel("device"), "Device");
  equal(participantKindLabel("service"), "Service");
  equal(formatShortKey("abcdefghijklmnopqrstuvwxyz", 8), "abcdefgh…");
  equal(formatShortKey(undefined), "—");
  deepEqual(
    describeUserGrant({
      contractDigest: "digest-agent",
      contractId: "trellis.agent@v1",
      displayName: "Trellis Agent",
      description: "Local delegated tooling",
      participantKind: "agent",
      capabilities: ["jobs.read"],
      grantedAt: "2026-04-10T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
    }),
    {
      title: "Trellis Agent",
      details: "Agent grant • trellis.agent@v1",
    },
  );
});

declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void;
};
