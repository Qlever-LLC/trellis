import { assertEquals, assertRejects } from "@std/assert";

import { buildLogoutSignaturePayload } from "../schemas.ts";
import { base64urlDecode, sha256, toArrayBuffer, utf8 } from "../utils.ts";
import { completeSessionLogout, logoutSession } from "./logout.ts";
import {
  generateSessionKey,
  hasSessionKey,
  logoutSessionSig,
} from "./session.ts";

async function assertRedirects(
  action: () => Promise<never>,
): Promise<void> {
  await assertRejects(action, Error, "Redirecting after logout");
}

Deno.test("logoutSession POSTs signed JSON request and parses response", async () => {
  const handle = await generateSessionKey({ persistence: "temporary" });
  const originalNow = Date.now;
  let input = "";
  let init: RequestInit | undefined;

  try {
    Date.now = () => 1_735_689_600_000;
    const response = await logoutSession({
      authUrl: "https://auth.example/",
      handle,
      returnTo: "https://app.example/signed-out",
      providerLogout: true,
      federatedProviderLogout: true,
      fetch: (async (requestInput, requestInit) => {
        input = String(requestInput);
        init = requestInit;
        return new Response(JSON.stringify({
          success: true,
          redirectTo: "https://idp.example/logout",
        }));
      }) as typeof fetch,
    });

    assertEquals(input, "https://auth.example/auth/sessions/logout");
    assertEquals(init?.method, "POST");
    assertEquals(init?.headers, { "content-type": "application/json" });
    const body = JSON.parse(String(init?.body));
    assertEquals(body.sessionKey, handle.sessionKey);
    assertEquals(body.iat, 1_735_689_600);
    assertEquals(body.providerLogout, true);
    assertEquals(body.federatedProviderLogout, true);
    assertEquals(body.returnTo, "https://app.example/signed-out");
    assertEquals(body.responseMode, "json");

    const digest = await sha256(
      utf8(`logout-session:${
        buildLogoutSignaturePayload({
          iat: 1_735_689_600,
          providerLogout: true,
          federatedProviderLogout: true,
          returnTo: "https://app.example/signed-out",
          responseMode: "json",
        })
      }`),
    );
    const verified = await crypto.subtle.verify(
      { name: "Ed25519" },
      handle.publicKey,
      toArrayBuffer(base64urlDecode(body.sig)),
      toArrayBuffer(digest),
    );

    assertEquals(verified, true);
    assertEquals(response, {
      success: true,
      redirectTo: "https://idp.example/logout",
    });
  } finally {
    Date.now = originalNow;
  }
});

Deno.test("logoutSession rejects HTTP failures clearly", async () => {
  const handle = await generateSessionKey({ persistence: "temporary" });

  await assertRejects(
    () =>
      logoutSession({
        authUrl: "https://auth.example",
        handle,
        fetch: (async () =>
          new Response("no", { status: 503 })) as typeof fetch,
      }),
    Error,
    "Logout request failed with HTTP 503",
  );
});

Deno.test("completeSessionLogout clears session key and navigates to returned redirect", async () => {
  const handle = await generateSessionKey({ persistence: "temporary" });
  const assigned: string[] = [];
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        success: true,
        redirectTo: "https://idp.example/logout",
      }))) as typeof fetch;

    await assertRedirects(() =>
      completeSessionLogout({
        authUrl: "https://auth.example",
        handle,
        returnTo: "https://app.example/signed-out",
        providerLogout: true,
        location: {
          href: "",
          assign: (target) => assigned.push(String(target)),
        },
      })
    );

    assertEquals(assigned, ["https://idp.example/logout"]);
    assertEquals(await hasSessionKey({ persistence: "temporary" }), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("completeSessionLogout falls back to returnTo when no redirect is returned", async () => {
  const handle = await generateSessionKey({ persistence: "temporary" });
  const assigned: string[] = [];
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: true }))) as typeof fetch;

    await assertRedirects(() =>
      completeSessionLogout({
        authUrl: "https://auth.example",
        handle,
        returnTo: "https://app.example/signed-out",
        location: {
          href: "",
          assign: (target) =>
            assigned.push(String(target)),
        },
      })
    );

    assertEquals(assigned, ["https://app.example/signed-out"]);
    assertEquals(await hasSessionKey({ persistence: "temporary" }), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("completeSessionLogout clears session key after HTTP failure and falls back to returnTo", async () => {
  const handle = await generateSessionKey({ persistence: "temporary" });
  const assigned: string[] = [];
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async () =>
      new Response("unavailable", { status: 503 })) as typeof fetch;

    await assertRedirects(() =>
      completeSessionLogout({
        authUrl: "https://auth.example",
        handle,
        returnTo: "https://app.example/signed-out",
        location: {
          href: "",
          assign: (target) =>
            assigned.push(String(target)),
        },
      })
    );

    assertEquals(assigned, ["https://app.example/signed-out"]);
    assertEquals(await hasSessionKey({ persistence: "temporary" }), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("completeSessionLogout uses slash fallback when no redirect or returnTo is available", async () => {
  const handle = await generateSessionKey({ persistence: "temporary" });
  const assigned: string[] = [];
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: true }))) as typeof fetch;

    await assertRedirects(() =>
      completeSessionLogout({
        authUrl: "https://auth.example",
        handle,
        location: {
          href: "",
          assign: (target) =>
            assigned.push(String(target)),
        },
      })
    );

    assertEquals(assigned, ["/"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("logoutSessionSig signs the canonical logout-session digest", async () => {
  const handle = await generateSessionKey({ persistence: "temporary" });
  const input = {
    iat: 1_735_689_600,
    providerLogout: true,
    returnTo: "https://app.example/signed-out",
    responseMode: "json" as const,
  };

  const sig = await logoutSessionSig(handle, input);
  const digest = await sha256(
    utf8(`logout-session:${buildLogoutSignaturePayload(input)}`),
  );
  const verified = await crypto.subtle.verify(
    { name: "Ed25519" },
    handle.publicKey,
    toArrayBuffer(base64urlDecode(sig)),
    toArrayBuffer(digest),
  );

  assertEquals(verified, true);
});
