import { assertEquals } from "@std/assert";

import {
  connectionFilterForSession,
  connectionFilterForUser,
  connectionFilterForUserNkey,
  connectionKey,
  decodeConnectionScopeSegment,
  encodeConnectionScopeSegment,
  parseConnectionKey,
} from "./connections.ts";

Deno.test("connection scope encoding round-trips dotted Trellis IDs", () => {
  const scopeId = "github.user.with.dots";
  const encoded = encodeConnectionScopeSegment(scopeId);

  assertEquals(encoded.includes("."), false);
  assertEquals(decodeConnectionScopeSegment(encoded), scopeId);
  assertEquals(
    connectionKey("sk", scopeId, "user_nkey"),
    `sk.${encoded}.user_nkey`,
  );
  assertEquals(parseConnectionKey(`sk.${encoded}.user_nkey`), {
    sessionKey: "sk",
    scopeId,
    userNkey: "user_nkey",
  });
});

Deno.test("connection key parser supports legacy raw dotted scope IDs", () => {
  assertEquals(parseConnectionKey("sk.github.user.with.dots.user_nkey"), {
    sessionKey: "sk",
    scopeId: "github.user.with.dots",
    userNkey: "user_nkey",
  });
});

Deno.test("connection filters avoid raw dotted scope IDs", () => {
  assertEquals(connectionFilterForSession("sk"), "sk.>");
  assertEquals(
    connectionFilterForUser("github.user.with.dots"),
    `>.${encodeConnectionScopeSegment("github.user.with.dots")}.>`,
  );
  assertEquals(connectionFilterForUserNkey("user_nkey"), null);
});
