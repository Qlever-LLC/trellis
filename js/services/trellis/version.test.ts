import { assertEquals } from "@std/assert";
import { Hono } from "@hono/hono";

import { buildVersionInfo, registerVersionRoute } from "./version.ts";

function env(values: Record<string, string | undefined>) {
  return {
    get(name: string): string | undefined {
      return values[name];
    },
  };
}

Deno.test("buildVersionInfo uses package version by default", () => {
  assertEquals(buildVersionInfo(env({})), {
    service: "trellis",
    version: "0.8.0",
  });
});

Deno.test("buildVersionInfo includes runtime version and revision", () => {
  assertEquals(
    buildVersionInfo(env({
      TRELLIS_VERSION: "v0.8.0-rc.5",
      TRELLIS_REVISION: "bf0d10b52bd9e77167fb1d23f76fc8100516c2b1",
    })),
    {
      service: "trellis",
      version: "v0.8.0-rc.5",
      revision: "bf0d10b52bd9e77167fb1d23f76fc8100516c2b1",
    },
  );
});

Deno.test("GET /version returns public version metadata", async () => {
  const app = new Hono();
  registerVersionRoute(app, env({}));

  const response = await app.request("http://trellis/version");

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    service: "trellis",
    version: "0.8.0",
  });
});
