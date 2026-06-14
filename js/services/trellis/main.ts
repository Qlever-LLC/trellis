import { initTelemetry } from "@qlever-llc/trellis/telemetry";

import { loadConfig } from "./config.ts";
import { startTrellisControlPlane } from "./runtime.ts";

initTelemetry("trellis");

const PROCESS_SHUTDOWN_TIMEOUT_MS = 10_000;
const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

const config = loadConfig();
const controlPlane = await startTrellisControlPlane({ config });

let shuttingDown: Promise<void> | null = null;
const shutdownSignalListeners = new Map<ShutdownSignal, () => void>();

function removeShutdownSignalListeners(): void {
  for (const [signal, listener] of shutdownSignalListeners) {
    Deno.removeSignalListener(signal, listener);
  }
  shutdownSignalListeners.clear();
}

function shutdown(): Promise<void> {
  shuttingDown ??= controlPlane.stop();
  return shuttingDown;
}

async function shutdownForSignal(signal: ShutdownSignal): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      shutdown(),
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
    console.error("Failed during Trellis shutdown", { error, signal });
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
