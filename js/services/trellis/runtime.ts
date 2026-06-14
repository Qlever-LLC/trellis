import { Hono } from "@hono/hono";
import type { LoggerLike } from "@qlever-llc/trellis/host/control-plane";

import { createRuntimeGlobals } from "./bootstrap/globals.ts";
import { registerControlPlane } from "./bootstrap/register.ts";
import type { Config } from "./config.ts";
import { registerVersionRoute } from "./version.ts";

const SERVER_DRAIN_TIMEOUT_MS = 5_000;

const noopLogger: LoggerLike = {
  child: () => noopLogger,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Options for starting the Trellis control-plane inside the current process. */
export type StartTrellisControlPlaneOptions = {
  config: Config;
  log?: false | LoggerLike;
};

/** Handle returned by an embedded Trellis control-plane runtime. */
export type TrellisControlPlaneHandle = {
  readonly url: string;
  readonly bootstrapUrl: string;
  wait(): Promise<void>;
  stop(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
};

type BackgroundTasks = Awaited<ReturnType<typeof registerControlPlane>>;
type Server = ReturnType<typeof Deno.serve>;

function aggregateStartupFailure(error: unknown, cleanupResults: unknown[]) {
  if (cleanupResults.length === 0) return error;
  return new AggregateError(
    [error, ...cleanupResults],
    "Trellis startup failed and cleanup was incomplete",
  );
}

async function waitForServerDrain(server: Server): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

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

function publicUrl(config: Config, server: Server): string {
  const configured = config.web.publicOrigin ?? config.oauth.redirectBase;
  if (configured) return configured.replace(/\/$/, "");
  const port = "port" in server.addr ? server.addr.port : config.port;
  return `http://localhost:${port}`;
}

async function cleanupStartupFailure(args: {
  error: unknown;
  logger: Pick<LoggerLike, "error">;
  runtime: Awaited<ReturnType<typeof createRuntimeGlobals>> | undefined;
  backgroundTasks: BackgroundTasks | undefined;
  server: Server | undefined;
  serverAbort: AbortController | undefined;
}): Promise<never> {
  const cleanupFailures: unknown[] = [];
  args.serverAbort?.abort();
  if (args.server) {
    try {
      await waitForServerDrain(args.server);
    } catch (cleanupError) {
      cleanupFailures.push(cleanupError);
      args.logger.error(
        { error: cleanupError },
        "Trellis startup server drain failed",
      );
    }
  }
  if (args.backgroundTasks) {
    try {
      await args.backgroundTasks.stop();
    } catch (cleanupError) {
      cleanupFailures.push(cleanupError);
      args.logger.error(
        { error: cleanupError },
        "Trellis startup background cleanup failed",
      );
    }
  }
  if (args.runtime) {
    try {
      await args.runtime.shutdownGlobals();
    } catch (cleanupError) {
      cleanupFailures.push(cleanupError);
      args.logger.error(
        { error: cleanupError },
        "Trellis startup runtime cleanup failed",
      );
    }
  }
  throw aggregateStartupFailure(args.error, cleanupFailures);
}

/** Starts the real Trellis control-plane in-process and returns its lifecycle handle. */
export async function startTrellisControlPlane(
  options: StartTrellisControlPlaneOptions,
): Promise<TrellisControlPlaneHandle> {
  let runtime: Awaited<ReturnType<typeof createRuntimeGlobals>> | undefined;
  let backgroundTasks: BackgroundTasks | undefined;
  let serverAbort: AbortController | undefined;
  let server: Server | undefined;
  let logger: LoggerLike = noopLogger;

  try {
    const app = new Hono();
    registerVersionRoute(app);
    runtime = await createRuntimeGlobals(options.config);
    logger = options.log === false ? noopLogger : options.log ?? runtime.logger;
    backgroundTasks = await registerControlPlane({
      app,
      config: options.config,
      runtime: { ...runtime, logger },
    });

    serverAbort = new AbortController();
    server = Deno.serve(
      {
        port: options.config.port,
        signal: serverAbort.signal,
      },
      app.fetch,
    );
    const activeRuntime = runtime;
    const activeBackgroundTasks = backgroundTasks;
    const activeServerAbort = serverAbort;
    const activeServer = server;

    const url = publicUrl(options.config, activeServer);

    let stopping: Promise<void> | undefined;
    const handle: TrellisControlPlaneHandle = {
      url,
      bootstrapUrl: `${url}/bootstrap`,
      wait: () => activeServer.finished,
      stop() {
        stopping ??= (async () => {
          const failures: unknown[] = [];
          activeServerAbort.abort();
          try {
            await waitForServerDrain(activeServer);
          } catch (error) {
            failures.push(error);
            logger.error({ error }, "Trellis shutdown server drain failed");
          }
          try {
            await activeBackgroundTasks.stop();
          } catch (error) {
            failures.push(error);
            logger.error(
              { error },
              "Trellis shutdown background cleanup failed",
            );
          }
          try {
            await activeRuntime.shutdownGlobals();
          } catch (error) {
            failures.push(error);
            logger.error({ error }, "Trellis shutdown runtime cleanup failed");
          }
          if (failures.length > 0) {
            throw new AggregateError(
              failures,
              `Failed to clean up ${failures.length} Trellis shutdown step(s)`,
            );
          }
        })();
        return stopping;
      },
      [Symbol.asyncDispose]() {
        return this.stop();
      },
    };
    return handle;
  } catch (error) {
    return await cleanupStartupFailure({
      error,
      logger,
      runtime,
      backgroundTasks,
      server,
      serverAbort,
    });
  }
}
