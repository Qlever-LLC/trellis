import { assertEquals } from "@std/assert";
import {
  buildBrowserNatsConnectionOptions,
  createBindingTokenAuthenticator,
} from "./nats_connect.ts";

Deno.test("createBindingTokenAuthenticator reads the current token value", () => {
  const tokenRef = { value: "token-1" };
  const authenticator = createBindingTokenAuthenticator(tokenRef);
  const firstAuth = authenticator();

  assertEquals(
    firstAuth && typeof firstAuth === "object" && "auth_token" in firstAuth
      ? firstAuth.auth_token
      : undefined,
    "token-1",
  );

  tokenRef.value = "token-2";
  const secondAuth = authenticator();

  assertEquals(
    secondAuth && typeof secondAuth === "object" && "auth_token" in secondAuth
      ? secondAuth.auth_token
      : undefined,
    "token-2",
  );
});

Deno.test("buildBrowserNatsConnectionOptions keeps reconnect defaults", () => {
  const options = buildBrowserNatsConnectionOptions({
    servers: ["wss://example.test"],
    sentinelRef: { jwt: "jwt", seed: "seed" },
    tokenRef: { value: "token" },
    inboxPrefix: "_INBOX.test",
  });

  assertEquals(options.reconnect, true);
  assertEquals(options.maxReconnectAttempts, 5);
  assertEquals(options.reconnectTimeWait, 2000);
  assertEquals(options.inboxPrefix, "_INBOX.test");
});
