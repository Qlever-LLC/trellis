import { assertEquals } from "@std/assert";

import {
  localLoginErrorMessage,
  shouldOfferPortalReturnLink,
  shouldStayOnPortalCompletionPage,
  submitLocalLogin,
} from "./page_state.ts";

Deno.test("shouldStayOnPortalCompletionPage keeps same-page detached completion in portal", () => {
  assertEquals(
    shouldStayOnPortalCompletionPage(
      new URL(
        "https://auth.example.com/_trellis/portal/users/login?flowId=flow-1",
      ),
      "https://auth.example.com/_trellis/portal/users/login?flowId=flow-1",
    ),
    true,
  );
});

Deno.test("shouldStayOnPortalCompletionPage still follows app callbacks", () => {
  assertEquals(
    shouldStayOnPortalCompletionPage(
      new URL(
        "https://auth.example.com/_trellis/portal/users/login?flowId=flow-1",
      ),
      "http://localhost:4173/callback?flowId=flow-1",
    ),
    false,
  );
});

Deno.test("shouldOfferPortalReturnLink hides self-links back to the same portal page", () => {
  assertEquals(
    shouldOfferPortalReturnLink(
      new URL(
        "https://auth.example.com/_trellis/portal/users/login?flowId=flow-1",
      ),
      "https://auth.example.com/_trellis/portal/users/login?flowId=flow-1",
    ),
    false,
  );
});

Deno.test("shouldOfferPortalReturnLink still allows returning to app callbacks", () => {
  assertEquals(
    shouldOfferPortalReturnLink(
      new URL(
        "https://auth.example.com/_trellis/portal/users/login?flowId=flow-1",
      ),
      "http://localhost:4173/callback?flowId=flow-1",
    ),
    true,
  );
});

Deno.test("localLoginErrorMessage formats expected local-login failures", () => {
  assertEquals(
    localLoginErrorMessage(403, "invalid_credentials"),
    "Invalid username or password.",
  );
  assertEquals(
    localLoginErrorMessage(403, "user_inactive"),
    "This account is inactive. Contact an administrator for access.",
  );
  assertEquals(
    localLoginErrorMessage(404, null),
    "This sign-in request has expired. Return to the app and start sign-in again.",
  );
});

Deno.test("submitLocalLogin posts expected URL and payload", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  await submitLocalLogin(
    "https://auth.example.com/base",
    { flowId: "flow-1", username: "ada", password: "secret" },
    (input, init) => {
      capturedUrl = input.toString();
      capturedInit = init;
      return Promise.resolve(
        Response.json({ status: "authenticated", flowId: "flow-1" }),
      );
    },
  );

  assertEquals(capturedUrl, "https://auth.example.com/auth/login/local");
  assertEquals(capturedInit?.method, "POST");
  assertEquals(capturedInit?.headers, { "content-type": "application/json" });
  assertEquals(
    capturedInit?.body,
    JSON.stringify({ flowId: "flow-1", username: "ada", password: "secret" }),
  );
});
