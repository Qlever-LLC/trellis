import { Hono } from "@hono/hono";
import { initTracing } from "@qlever-llc/trellis-telemetry";

import { getConfig } from "./config.ts";
import {
  registerControlPlane,
  startControlPlaneBackgroundTasks,
} from "./control_plane.ts";
import { logger, shutdownGlobals } from "./globals.ts";
import { registerHttpRoutes } from "./http_routes.ts";

initTracing("trellis");

const config = getConfig();
const app = new Hono();

const controlPlane = await registerControlPlane();

registerHttpRoutes(app, { contractStore: controlPlane.contractStore });

const backgroundTasks = startControlPlaneBackgroundTasks();

const serverAbort = new AbortController();
const server = Deno.serve({
  port: config.port,
  signal: serverAbort.signal,
}, app.fetch);

let shuttingDown: Promise<void> | null = null;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return shuttingDown;
  }

  shuttingDown = (async () => {
    logger.info({ signal }, "Shutting down Trellis service");
    serverAbort.abort();
    await backgroundTasks.stop();
    await shutdownGlobals();
    await server.finished;
    logger.info({ signal }, "Trellis service stopped");
  })();

  return shuttingDown;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  Deno.addSignalListener(signal, () => {
    void shutdown(signal).catch((error) => {
      logger.error({ error, signal }, "Failed during Trellis shutdown");
    });
  });
}
