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

Deno.test("build app urls preserve selected auth url when it differs from default", () => {
  const loginUrl = buildAppLoginUrl("/profile", new URL("http://localhost:5173/"), undefined, "http://localhost:4000");
  const callbackUrl = buildAppCallbackUrl("/profile", new URL("http://localhost:5173/"), "http://localhost:4000");

  assertEquals(loginUrl, "http://localhost:5173/login?redirectTo=%2Fprofile&authUrl=http%3A%2F%2Flocalhost%3A4000");
  assertEquals(callbackUrl, "http://localhost:5173/callback?redirectTo=%2Fprofile&authUrl=http%3A%2F%2Flocalhost%3A4000");
});

Deno.test("persistSelectedAuthUrl falls back to default auth url when invalid", () => {
  const storage = createMemoryStorage();
  const selected = persistSelectedAuthUrl("not-a-url", storage);

  assertEquals(selected, APP_CONFIG.authUrl);
  assertEquals(storage.getItem("trellis.console.authUrl"), APP_CONFIG.authUrl);
});
