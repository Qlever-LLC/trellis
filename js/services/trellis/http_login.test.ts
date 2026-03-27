import { assertEquals } from "@std/assert";

import { shouldRenderProviderChooser } from "./http_login.ts";

Deno.test("provider chooser shows when forced in config", () => {
  assertEquals(shouldRenderProviderChooser(1, true), true);
  assertEquals(shouldRenderProviderChooser(1, false), false);
  assertEquals(shouldRenderProviderChooser(2, false), true);
});
