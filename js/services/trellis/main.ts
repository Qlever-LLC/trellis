import { Hono } from "@hono/hono";
import { initTracing } from "@qlever-llc/trellis/tracing";
import { startControlPlaneBackgroundTasks } from "./bootstrap/control_plane.ts";
import { createRuntimeGlobals } from "./bootstrap/globals.ts";
import { registerControlPlane } from "./bootstrap/register.ts";
import { loadConfig } from "./config.ts";

initTracing("trellis");

const config = loadConfig();
const app = new Hono();
const runtime = await createRuntimeGlobals(config);

const SERVER_DRAIN_TIMEOUT_MS = 5_000;
const PROCESS_SHUTDOWN_TIMEOUT_MS = 10_000;
const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

function aggregateStartupFailure(error: unknown, cleanupResults: unknown[]) {
  if (cleanupResults.length === 0) return error;
  return new AggregateError(
    [error, ...cleanupResults],
    "Trellis startup failed and cleanup was incomplete",
  );
}

async function waitForServerDrain(
  server: ReturnType<typeof Deno.serve>,
): Promise<void> {
  let timeoutId: number | undefined;

  try {
    await Promise.race([
      server.finished,
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(() => {
          server.unref();
          resolve();
        }, SERVER_DRAIN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

async function startTrellisService() {
  const { logger } = runtime;
  let backgroundTasks:
    | ReturnType<typeof startControlPlaneBackgroundTasks>
    | undefined;
  let serverAbort: AbortController | undefined;
  let server: ReturnType<typeof Deno.serve> | undefined;

  try {
    backgroundTasks = await registerControlPlane({ app, config, runtime });

    serverAbort = new AbortController();
    server = Deno.serve(
      {
        port: config.port,
        signal: serverAbort.signal,
      },
      app.fetch,
    );

    return { backgroundTasks, logger, server, serverAbort };
  } catch (error) {
    serverAbort?.abort();
    const cleanupFailures: unknown[] = [];
    if (server) {
      try {
        await waitForServerDrain(server);
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
        logger.error(
          { error: cleanupError },
          "Trellis startup server drain failed",
        );
      }
    }
    if (backgroundTasks) {
      try {
        await backgroundTasks.stop();
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
        logger.error(
          { error: cleanupError },
          "Trellis startup background cleanup failed",
        );
      }
    }
    try {
      await runtime.shutdownGlobals();
    } catch (cleanupError) {
      cleanupFailures.push(cleanupError);
      logger.error(
        { error: cleanupError },
        "Trellis startup runtime cleanup failed",
      );
    }
    throw aggregateStartupFailure(error, cleanupFailures);
  }
}

const { backgroundTasks, logger, server, serverAbort } =
  await startTrellisService();

let shuttingDown: Promise<void> | null = null;
const shutdownSignalListeners = new Map<ShutdownSignal, () => void>();

function removeShutdownSignalListeners(): void {
  for (const [signal, listener] of shutdownSignalListeners) {
    Deno.removeSignalListener(signal, listener);
  }
  shutdownSignalListeners.clear();
}

function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return shuttingDown;
  }

  shuttingDown = (async () => {
    logger.info({ signal }, "Shutting down Trellis service");
    serverAbort.abort();
    const failures: unknown[] = [];
    try {
      await waitForServerDrain(server);
    } catch (error) {
      failures.push(error);
      logger.error(
        { error, signal },
        "Trellis shutdown server drain failed",
      );
    }
    try {
      await backgroundTasks.stop();
    } catch (error) {
      failures.push(error);
      logger.error(
        { error, signal },
        "Trellis shutdown background cleanup failed",
      );
    }
    try {
      await runtime.shutdownGlobals();
    } catch (error) {
      failures.push(error);
      logger.error(
        { error, signal },
        "Trellis shutdown runtime cleanup failed",
      );
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Failed to clean up ${failures.length} Trellis shutdown step(s)`,
      );
    }
    logger.info({ signal }, "Trellis service stopped");
  })();

  return shuttingDown;
}

async function shutdownForSignal(signal: ShutdownSignal): Promise<void> {
  let timeoutId: number | undefined;

  try {
    await Promise.race([
      shutdown(signal),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(
              new Error(
                `Trellis shutdown timed out after ${PROCESS_SHUTDOWN_TIMEOUT_MS}ms`,
              ),
            ),
          PROCESS_SHUTDOWN_TIMEOUT_MS,
        );
      }),
    ]);
    removeShutdownSignalListeners();
  } catch (error) {
    logger.error({ error, signal }, "Failed during Trellis shutdown");
    Deno.exit(1);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

for (const signal of SHUTDOWN_SIGNALS) {
  const listener = () => {
    void shutdownForSignal(signal);
  };
  shutdownSignalListeners.set(signal, listener);
  Deno.addSignalListener(signal, listener);
}
