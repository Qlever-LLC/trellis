import { assertEquals } from "@std/assert";

import {
  buildAuthCalloutPermissions,
  OPERATION_RESPONSE_MAX,
} from "./permissions.ts";

Deno.test("buildAuthCalloutPermissions grants bounded multi-response replies", () => {
  const permissions = buildAuthCalloutPermissions({
    publishAllow: ["rpc.v1.Demo.Call"],
    subscribeAllow: ["events.v1.Demo.>"],
    inboxPrefix: "_INBOX.session-key",
    issuerAccount: "ACCT123",
    sessionType: "service",
  });

  assertEquals(permissions.resp, { max: OPERATION_RESPONSE_MAX });
  assertEquals(permissions.sub?.allow, [
    "events.v1.Demo.>",
    "_INBOX.session-key.>",
  ]);
  assertEquals(permissions.pub?.allow, ["rpc.v1.Demo.Call"]);
});

Deno.test("buildAuthCalloutPermissions deduplicates publish and subscribe subjects", () => {
  const permissions = buildAuthCalloutPermissions({
    publishAllow: ["rpc.v1.Demo.Call", "rpc.v1.Demo.Call"],
    subscribeAllow: ["_INBOX.session-key.>", "events.v1.Demo.>"],
    inboxPrefix: "_INBOX.session-key",
    issuerAccount: "ACCT123",
    sessionType: "service",
  });

  assertEquals(permissions.pub?.allow, ["rpc.v1.Demo.Call"]);
  assertEquals(permissions.sub?.allow, [
    "_INBOX.session-key.>",
    "events.v1.Demo.>",
  ]);
});

Deno.test("buildAuthCalloutPermissions keeps non-streaming sessions unary", () => {
  const userPermissions = buildAuthCalloutPermissions({
    publishAllow: ["rpc.v1.Demo.Call"],
    subscribeAllow: ["events.v1.Demo.>"],
    inboxPrefix: "_INBOX.session-key",
    issuerAccount: "ACCT123",
    sessionType: "user",
  });
  const devicePermissions = buildAuthCalloutPermissions({
    publishAllow: ["rpc.v1.Demo.Call"],
    subscribeAllow: ["events.v1.Demo.>"],
    inboxPrefix: "_INBOX.session-key",
    issuerAccount: "ACCT123",
    sessionType: "device",
  });

  assertEquals(userPermissions.resp, { max: 1 });
  assertEquals(devicePermissions.resp, { max: 1 });
});
