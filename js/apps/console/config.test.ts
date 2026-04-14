import { assertEquals } from "@std/assert";

import {
  APP_CONFIG,
  buildAppCallbackUrl,
  buildAppLoginUrl,
  getSelectedAuthUrl,
  persistSelectedAuthUrl,
} from "./src/lib/config.ts";

function createMemoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    },
    removeItem(key: string): void {
      values.delete(key);
    },
  };
}

Deno.test("selected auth url prefers query param and persists it", () => {
  const storage = createMemoryStorage();
  const selected = getSelectedAuthUrl(
    new URL("http://localhost:5173/login?authUrl=http://127.0.0.1:4000/"),
    storage,
  );

  assertEquals(selected, "http://localhost:4000");
  assertEquals(storage.getItem("trellis.console.authUrl"), "http://localhost:4000");
});

Deno.test("build app urls preserve selected auth url when it is provided", () => {
  const loginUrl = buildAppLoginUrl("/profile", new URL("http://localhost:5173/"), undefined, "http://localhost:4000");
  const callbackUrl = buildAppCallbackUrl("/profile", new URL("http://localhost:5173/"), "http://localhost:4000");

  assertEquals(loginUrl, "http://localhost:5173/login?redirectTo=%2Fprofile&authUrl=http%3A%2F%2Flocalhost%3A4000");
  assertEquals(callbackUrl, "http://localhost:5173/callback?redirectTo=%2Fprofile&authUrl=http%3A%2F%2Flocalhost%3A4000");
});

Deno.test("build app urls omit auth url when none is selected", () => {
  const loginUrl = buildAppLoginUrl("/profile", new URL("http://localhost:5173/"));
  const callbackUrl = buildAppCallbackUrl("/profile", new URL("http://localhost:5173/"));

  assertEquals(loginUrl, "http://localhost:5173/login?redirectTo=%2Fprofile");
  assertEquals(callbackUrl, "http://localhost:5173/callback?redirectTo=%2Fprofile");
});

Deno.test("build app urls accept base-aware login and callback paths", () => {
  const loginUrl = buildAppLoginUrl(
    "/current/console/profile",
    new URL("http://localhost:5173/current/console/"),
    undefined,
    "http://localhost:4000",
    "/current/console/login",
  );
  const callbackUrl = buildAppCallbackUrl(
    "/current/console/profile",
    new URL("http://localhost:5173/current/console/"),
    "http://localhost:4000",
    "/current/console/callback",
  );

  assertEquals(loginUrl, "http://localhost:5173/current/console/login?redirectTo=%2Fcurrent%2Fconsole%2Fprofile&authUrl=http%3A%2F%2Flocalhost%3A4000");
  assertEquals(callbackUrl, "http://localhost:5173/current/console/callback?redirectTo=%2Fcurrent%2Fconsole%2Fprofile&authUrl=http%3A%2F%2Flocalhost%3A4000");
});

Deno.test("selected auth url stays undefined when nothing is configured", () => {
  const storage = createMemoryStorage();
  const selected = getSelectedAuthUrl(new URL("http://localhost:5173/login"), storage);

  assertEquals(APP_CONFIG.authUrl, undefined);
  assertEquals(selected, undefined);
});

Deno.test("persistSelectedAuthUrl returns undefined when invalid and no default exists", () => {
  const storage = createMemoryStorage();
  const selected = persistSelectedAuthUrl("not-a-url", storage);

  assertEquals(APP_CONFIG.authUrl, undefined);
  assertEquals(selected, undefined);
  assertEquals(storage.getItem("trellis.console.authUrl"), null);
});
