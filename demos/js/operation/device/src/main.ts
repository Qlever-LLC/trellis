import { isErr, TrellisDevice } from "@qlever-llc/trellis";
import contract from "../contracts/demo_inspection_operation_device.ts";
import { ASSIGNED_INSPECTIONS } from "../../../shared/field_data.ts";
import { printScenarioHeading } from "../../../shared/logging.ts";

const trellisUrl = Deno.args[0]?.trim();
const rootSecret = Deno.args[1]?.trim();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type WatchedOperationRef = {
  watch(): {
    orThrow(): Promise<AsyncIterable<unknown>>;
  };
};

type OperationWatchEvent = {
  type: string;
  snapshot?: {
    state?: string;
  };
  progress?: {
    stage?: string;
    message?: string;
  };
};

function asOperationWatchEvent(value: unknown): OperationWatchEvent | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const event = value as Record<string, unknown>;
  const type = event.type;
  if (typeof type !== "string") {
    return undefined;
  }

  const snapshot = event.snapshot;
  const progress = event.progress;
  return {
    type,
    snapshot: snapshot && typeof snapshot === "object"
      ? { state: typeof (snapshot as Record<string, unknown>).state === "string" ? (snapshot as Record<string, unknown>).state as string : undefined }
      : undefined,
    progress: progress && typeof progress === "object"
      ? {
        stage: typeof (progress as Record<string, unknown>).stage === "string"
          ? (progress as Record<string, unknown>).stage as string
          : undefined,
        message: typeof (progress as Record<string, unknown>).message === "string"
          ? (progress as Record<string, unknown>).message as string
          : undefined,
      }
      : undefined,
  };
}

function watchOperation(
  label: string,
  reference: WatchedOperationRef,
): Promise<void> {
  const done = (async () => {
    const watch = await reference.watch().orThrow();
    for await (const event of watch) {
      const parsed = asOperationWatchEvent(event);
      if (!parsed) {
        continue;
      }

      if (parsed.type === "progress") {
        console.info(
          `${label} progress`,
          parsed.progress?.stage ?? "unknown",
          parsed.progress?.message ?? "",
        );
        continue;
      }

      console.info(`${label} event`, parsed.type, parsed.snapshot?.state ?? "unknown");
    }
  })();

  return done;
}

async function main(): Promise<void> {
  if (!trellisUrl || !rootSecret) {
    throw new Error("Usage: deno task start -- <trellisUrl> <rootSecret>");
  }

  const device = await TrellisDevice.connect({
    trellisUrl,
    contract,
    rootSecret,
    onActivationRequired: async (activation) => {
      console.info(activation.url);
      await activation.waitForOnlineApproval();
    },
  });
  const me = (await device.request("Auth.Me", {})).take();
  if (isErr(me)) {
    throw me.error;
  }

  printScenarioHeading("Inspection operation device");
  console.info("Connected as", me.device?.deviceId ?? "unknown-device");

  const cancelledInspectionId = ASSIGNED_INSPECTIONS[0]?.inspectionId;
  const completedInspectionId = ASSIGNED_INSPECTIONS[1]?.inspectionId;
  if (!cancelledInspectionId || !completedInspectionId) {
    throw new Error("operation demo requires at least two assigned inspections");
  }

  console.info("starting cancellation flow", { inspectionId: cancelledInspectionId });
  const cancelled = await device.operation("Inspection.Report.Generate")
    .input({ inspectionId: cancelledInspectionId })
    .start()
    .orThrow();
  console.info("cancel flow accepted", {
    id: cancelled.id,
    operation: cancelled.operation,
  });

  const cancelledWatch = watchOperation("cancel flow", cancelled);
  await sleep(1_200);

  const cancelledSnapshot = await cancelled.cancel().orThrow();
  console.info("cancel flow cancel()", cancelledSnapshot.state);

  const cancelledTerminal = await cancelled.wait().orThrow();
  console.info("cancel flow wait()", cancelledTerminal.state);
  await cancelledWatch;

  console.info("starting completion flow", { inspectionId: completedInspectionId });
  const completed = await device.operation("Inspection.Report.Generate")
    .input({ inspectionId: completedInspectionId })
    .start()
    .orThrow();
  console.info("completion flow accepted", {
    id: completed.id,
    operation: completed.operation,
  });

  const completedWatch = watchOperation("completion flow", completed);
  const completedTerminal = await completed.wait().orThrow();
  console.info("completion flow wait()", completedTerminal.state);
  console.info("completion flow output", completedTerminal.output);
  await completedWatch;
}

if (import.meta.main) {
  await main();
}
