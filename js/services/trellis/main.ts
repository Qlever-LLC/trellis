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
  shutdownGlobals,
  stateKV,
  trellis,
  userStorage,
} = runtime;

const contracts = createContractsModule({
  builtinContracts: await resolveBuiltinContracts(),
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

const backgroundTasks = startControlPlaneBackgroundTasks({
  contractStorage,
  userStorage,
  contractApprovalStorage,
  contractStore: contracts.contractStore,
});

const serverAbort = new AbortController();
const server = Deno.serve(
  {
    port: config.port,
    signal: serverAbort.signal,
  },
  app.fetch,
);

const SERVER_DRAIN_TIMEOUT_MS = 5_000;
const PROCESS_SHUTDOWN_TIMEOUT_MS = 10_000;

async function waitForServerDrain(): Promise<void> {
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

let shuttingDown: Promise<void> | null = null;

function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return shuttingDown;
  }

  shuttingDown = (async () => {
    logger.info({ signal }, "Shutting down Trellis service");
    serverAbort.abort();
    await waitForServerDrain();
    await backgroundTasks.stop();
    await shutdownGlobals();
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
