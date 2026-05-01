import type { Hono } from "@hono/hono";

import manifest from "./deno.json" with { type: "json" };

export type VersionInfo = {
  service: "trellis";
  version: string;
  revision?: string;
};

/** Builds the public Trellis service version payload. */
export function buildVersionInfo(env: Pick<typeof Deno.env, "get">): VersionInfo {
  const version = env.get("TRELLIS_VERSION")?.trim() || manifest.version;
  const revision = env.get("TRELLIS_REVISION")?.trim();
  return {
    service: "trellis",
    version,
    ...(revision ? { revision } : {}),
  };
}

/** Registers unauthenticated public service version metadata. */
export function registerVersionRoute(
  app: Hono,
  env: Pick<typeof Deno.env, "get"> = Deno.env,
): void {
  app.get("/version", (c) => c.json(buildVersionInfo(env)));
}
