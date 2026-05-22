import { assertEquals, assertRejects } from "@std/assert";

import {
  isFederatedRegistrationAvailable,
  isFederatedRegistrationProvider,
  isLocalRegistrationAvailable,
  localLoginErrorMessage,
  localRegistrationErrorMessage,
  shouldOfferPortalReturnLink,
  shouldStayOnPortalCompletionPage,
  submitLocalLogin,
  submitLocalRegistration,
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

Deno.test("registration gating requires explicit local availability", () => {
  assertEquals(
    isLocalRegistrationAvailable({
      status: "choose_provider",
      providers: [{ id: "local", displayName: "Local" }],
      registration: { localIdentity: { available: true } },
    }),
    true,
  );
  assertEquals(
    isLocalRegistrationAvailable({
      status: "choose_provider",
      providers: [{ id: "local", displayName: "Local" }],
    }),
    false,
  );
});

Deno.test("federated registration gating does not infer from provider list", () => {
  const state = {
    status: "choose_provider",
    providers: [{ id: "github", displayName: "GitHub" }],
  };

  assertEquals(isFederatedRegistrationAvailable(state), false);
  assertEquals(isFederatedRegistrationProvider(state, "github"), false);
  assertEquals(
    isFederatedRegistrationAvailable({
      ...state,
      registration: { federatedIdentity: { available: true, providers: [] } },
    }),
    true,
  );
  assertEquals(
    isFederatedRegistrationProvider({
      ...state,
      registration: {
        federatedIdentity: {
          available: true,
          providers: [{ id: "github", displayName: "GitHub" }],
        },
      },
    }, "github"),
    true,
  );
});

Deno.test("localRegistrationErrorMessage formats expected failures", () => {
  assertEquals(
    localRegistrationErrorMessage(409, "username_taken"),
    "That username is already in use.",
  );
  assertEquals(
    localRegistrationErrorMessage(403, "registration_unavailable"),
    "Account creation is not available for this sign-in request.",
  );
  assertEquals(
    localRegistrationErrorMessage(404, null),
    "This sign-in request has expired. Return to the app and start sign-in again.",
  );
});

Deno.test("submitLocalRegistration posts expected URL and payload", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  await submitLocalRegistration(
    "https://auth.example.com/base",
    "flow-1",
    {
      username: "ada",
      password: "secret",
      name: "Ada Lovelace",
      email: "ada@example.com",
    },
    (input, init) => {
      capturedUrl = input.toString();
      capturedInit = init;
      return Promise.resolve(Response.json({ status: "authenticated" }));
    },
  );

  assertEquals(
    capturedUrl,
    "https://auth.example.com/auth/flow/flow-1/register/local",
  );
  assertEquals(capturedInit?.method, "POST");
  assertEquals(capturedInit?.headers, { "content-type": "application/json" });
  assertEquals(
    capturedInit?.body,
    JSON.stringify({
      username: "ada",
      password: "secret",
      name: "Ada Lovelace",
      email: "ada@example.com",
    }),
  );
});

Deno.test("submitLocalRegistration throws formatted response errors", async () => {
  await assertRejects(
    () =>
      submitLocalRegistration(
        "https://auth.example.com",
        "flow-1",
        {
          username: "ada",
          password: "secret",
          name: "Ada Lovelace",
          email: "ada@example.com",
        },
        () =>
          Promise.resolve(
            Response.json({ error: "username_taken" }, { status: 409 }),
          ),
      ),
    Error,
    "That username is already in use.",
  );
});
