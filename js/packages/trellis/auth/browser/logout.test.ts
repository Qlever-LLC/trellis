import { assertEquals, assertRejects } from "@std/assert";

import { type BrowserLogoutInput, completeBrowserLogout } from "./logout.ts";
import { generateSessionKey, hasSessionKey } from "./session.ts";

async function assertRedirects(
  action: () => Promise<never>,
): Promise<void> {
  await assertRejects(action, Error, "Redirecting after logout");
}

Deno.test("completeBrowserLogout builds browser logout input and redirects to provider URL", async () => {
  await generateSessionKey({ persistence: "temporary" });
  const inputs: BrowserLogoutInput[] = [];
  const location: Pick<Location, "href"> = { href: "" };

  await assertRedirects(() =>
    completeBrowserLogout({
      logoutRequest: (input) => {
        inputs.push(input);
        return Promise.resolve({
          success: true,
          providerLogoutUrl: "https://idp.example/logout",
        });
      },
      returnTo: "https://app.example/signed-out",
      includeProviderLogout: true,
      location,
    })
  );

  assertEquals(inputs, [{
    browser: {
      returnTo: "https://app.example/signed-out",
      includeProviderLogout: true,
    },
  }]);
  assertEquals(location.href, "https://idp.example/logout");
  assertEquals(await hasSessionKey({ persistence: "temporary" }), false);
});

Deno.test("completeBrowserLogout falls back to returnTo when no provider URL is returned", async () => {
  await generateSessionKey({ persistence: "temporary" });
  const location: Pick<Location, "href"> = { href: "" };

  await assertRedirects(() =>
    completeBrowserLogout({
      logoutRequest: () => Promise.resolve({ success: true }),
      returnTo: "https://app.example/signed-out",
      location,
    })
  );

  assertEquals(location.href, "https://app.example/signed-out");
  assertEquals(await hasSessionKey({ persistence: "temporary" }), false);
});

Deno.test("completeBrowserLogout defaults includeProviderLogout when returnTo is provided", async () => {
  const inputs: BrowserLogoutInput[] = [];
  const location: Pick<Location, "href"> = { href: "" };

  await assertRedirects(() =>
    completeBrowserLogout({
      logoutRequest: (input) => {
        inputs.push(input);
        return Promise.resolve({ success: true });
      },
      returnTo: "https://app.example/signed-out",
      location,
    })
  );

  assertEquals(inputs, [{
    browser: {
      returnTo: "https://app.example/signed-out",
      includeProviderLogout: true,
    },
  }]);
});

Deno.test("completeBrowserLogout supports explicit includeProviderLogout false", async () => {
  const inputs: BrowserLogoutInput[] = [];
  const location: Pick<Location, "href"> = { href: "" };

  await assertRedirects(() =>
    completeBrowserLogout({
      logoutRequest: (input) => {
        inputs.push(input);
        return Promise.resolve({ success: true });
      },
      returnTo: "https://app.example/signed-out",
      includeProviderLogout: false,
      location,
    })
  );

  assertEquals(inputs, [{
    browser: {
      returnTo: "https://app.example/signed-out",
      includeProviderLogout: false,
    },
  }]);
});

Deno.test("completeBrowserLogout clears session key when logoutRequest rejects and redirects to fallback", async () => {
  await generateSessionKey({ persistence: "temporary" });
  const location: Pick<Location, "href"> = { href: "" };

  await assertRedirects(() =>
    completeBrowserLogout({
      logoutRequest: () => Promise.reject(new Error("RPC unavailable")),
      returnTo: "https://app.example/signed-out",
      location,
    })
  );

  assertEquals(location.href, "https://app.example/signed-out");
  assertEquals(await hasSessionKey({ persistence: "temporary" }), false);
});

Deno.test("completeBrowserLogout uses slash fallback when no returnTo or provider URL is available", async () => {
  const inputs: BrowserLogoutInput[] = [];
  const location: Pick<Location, "href"> = { href: "" };

  await assertRedirects(() =>
    completeBrowserLogout({
      logoutRequest: (input) => {
        inputs.push(input);
        return Promise.resolve({ success: true });
      },
      location,
    })
  );

  assertEquals(inputs, [{}]);
  assertEquals(location.href, "/");
});
