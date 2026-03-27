import { assertEquals } from "@std/assert";

import { renderLoginPage } from "./pages.ts";

Deno.test("renderLoginPage lists configured providers and preserves signed query params", () => {
  const html = renderLoginPage({
    instanceName: "Trellis Auth",
    providers: [
      { key: "github", displayName: "GitHub" },
      { key: "auth0", displayName: "Company SSO" },
    ],
    params: {
      redirectTo: "http://localhost:5173/profile",
      sessionKey: "session-key",
      sig: "sig-value",
      contract: "encoded-contract",
    },
  });

  assertEquals(html.includes("Continue with GitHub"), true);
  assertEquals(html.includes("Continue with Company SSO"), true);
  assertEquals(html.includes("/auth/login/github?redirectTo=http%3A%2F%2Flocalhost%3A5173%2Fprofile"), true);
  assertEquals(html.includes("/auth/login/auth0?redirectTo=http%3A%2F%2Flocalhost%3A5173%2Fprofile"), true);
  assertEquals(html.includes("sessionKey=session-key"), true);
  assertEquals(html.includes("sig=sig-value"), true);
  assertEquals(html.includes("contract=encoded-contract"), true);
});
