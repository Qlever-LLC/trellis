import { assertEquals } from "@std/assert";

import {
  shouldOfferPortalReturnLink,
  shouldStayOnPortalCompletionPage,
} from "./page_state.ts";

Deno.test("shouldStayOnPortalCompletionPage keeps same-page detached completion in portal", () => {
  assertEquals(
    shouldStayOnPortalCompletionPage(
        new URL("https://auth.example.com/_trellis/portal/users/login?flowId=flow-1"),
        "https://auth.example.com/_trellis/portal/users/login?flowId=flow-1",
    ),
    true,
  );
});

Deno.test("shouldStayOnPortalCompletionPage still follows app callbacks", () => {
  assertEquals(
    shouldStayOnPortalCompletionPage(
        new URL("https://auth.example.com/_trellis/portal/users/login?flowId=flow-1"),
      "http://localhost:4173/callback?flowId=flow-1",
    ),
    false,
  );
});

Deno.test("shouldOfferPortalReturnLink hides self-links back to the same portal page", () => {
  assertEquals(
    shouldOfferPortalReturnLink(
        new URL("https://auth.example.com/_trellis/portal/users/login?flowId=flow-1"),
        "https://auth.example.com/_trellis/portal/users/login?flowId=flow-1",
    ),
    false,
  );
});

Deno.test("shouldOfferPortalReturnLink still allows returning to app callbacks", () => {
  assertEquals(
    shouldOfferPortalReturnLink(
        new URL("https://auth.example.com/_trellis/portal/users/login?flowId=flow-1"),
      "http://localhost:4173/callback?flowId=flow-1",
    ),
    true,
  );
});
