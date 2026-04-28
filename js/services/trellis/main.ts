import { Hono } from "@hono/hono";
import { initTracing } from "@qlever-llc/trellis/tracing";
import { registerAuth } from "./auth/register.ts";
import {
  resolveBuiltinContracts,
  startControlPlaneBackgroundTasks,
} from "./bootstrap/control_plane.ts";
import { createRuntimeGlobals } from "./bootstrap/globals.ts";
import { registerCatalog } from "./catalog/register.ts";
import { createContractsModule } from "./catalog/runtime.ts";
import { getConfig } from "./config.ts";
import { registerState } from "./state/register.ts";
import { createStateHandlers } from "./state/rpc.ts";
import { StateStore } from "./state/storage.ts";

initTracing("trellis");

const config = getConfig();
const app = new Hono();
const runtime = await createRuntimeGlobals(config);

const SERVER_DRAIN_TIMEOUT_MS = 5_000;
const PROCESS_SHUTDOWN_TIMEOUT_MS = 10_000;

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
        timeoutId = setTimeout(resolve, SERVER_DRAIN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

async function startTrellisService() {
  const {
    browserFlowsKV,
    connectionsKV,
    contractApprovalStorage,
    contractStorage,
    deviceActivationReviewStorage,
    deviceActivationStorage,
    deviceDeploymentStorage,
    deviceInstanceStorage,
    devicePortalSelectionStorage,
    deviceProvisioningSecretStorage,
    instanceGrantPolicyStorage,
    logger,
    loginPortalSelectionStorage,
    natsAuth,
    natsTrellis,
    oauthStateKV,
    pendingAuthKV,
    portalDefaultStorage,
    portalProfileStorage,
    portalStorage,
    sentinelCreds,
    serviceDeploymentStorage,
    serviceInstanceStorage,
    sessionStorage,
    stateKV,
    trellis,
    userStorage,
  } = runtime;
  let backgroundTasks:
    | ReturnType<typeof startControlPlaneBackgroundTasks>
    | undefined;
  let serverAbort: AbortController | undefined;
  let server: ReturnType<typeof Deno.serve> | undefined;

  try {
    const contracts = createContractsModule({
      builtinContracts: resolveBuiltinContracts(),
      contractStorage,
      deviceDeploymentStorage,
      deviceInstanceStorage,
      logger,
      serviceInstanceStorage,
      serviceDeploymentStorage,
    });

    const stateHandlers = createStateHandlers({
      sessionStorage,
      state: new StateStore({ kv: stateKV }),
      contractStore: contracts.contractStore,
    });

    await registerCatalog({
      trellis,
      contracts,
      serviceInstanceStorage,
      logger,
    });

    await registerState({ trellis, stateHandlers });

    await registerAuth({
      app,
      config,
      trellis,
      contracts,
      contractStorage,
      userStorage,
      contractApprovalStorage,
      portalStorage,
      portalDefaultStorage,
      loginPortalSelectionStorage,
      devicePortalSelectionStorage,
      deviceDeploymentStorage,
      deviceInstanceStorage,
      deviceActivationStorage,
      deviceActivationReviewStorage,
      deviceProvisioningSecretStorage,
      instanceGrantPolicyStorage,
      portalProfileStorage,
      serviceDeploymentStorage,
      serviceInstanceStorage,
      sessionStorage,
      browserFlowsKV,
      connectionsKV,
      logger,
      natsAuth,
      natsTrellis,
      oauthStateKV,
      pendingAuthKV,
      sentinelCreds,
    });

    backgroundTasks = startControlPlaneBackgroundTasks({
      contractStorage,
      userStorage,
      contractApprovalStorage,
      deviceActivationStorage,
      deviceDeploymentStorage,
      instanceGrantPolicyStorage,
      serviceDeploymentStorage,
      serviceInstanceStorage,
      portalProfileStorage,
      portalStorage,
      connectionsKV,
      logger,
      natsAuth,
      sessionStorage,
      trellis,
      contractStore: contracts.contractStore,
      config,
    });

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

async function shutdownForSignal(signal: string): Promise<void> {
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
    Deno.exit(0);
  } catch (error) {
    logger.error({ error, signal }, "Failed during Trellis shutdown");
    Deno.exit(1);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  Deno.addSignalListener(signal, () => {
    void shutdownForSignal(signal);
  });
}
