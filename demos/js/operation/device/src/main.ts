import { TrellisDevice } from "@qlever-llc/trellis";
import contract from "../contracts/demo_inspection_operation_device.ts";
import { ASSIGNED_INSPECTIONS } from "../../../shared/field_data.ts";
import { printScenarioHeading } from "../../../shared/logging.ts";

const trellisUrl = Deno.args[0]?.trim();
const rootSecret = Deno.args[1]?.trim();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function progressFields(value: unknown): { stage: string; message: string } | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const stage = record.stage;
  const message = record.message;
  if (typeof stage !== "string" || typeof message !== "string") {
    return null;
  }

  return { stage, message };
}

async function main(): Promise<void> {
  if (!trellisUrl || !rootSecret) {
    throw new Error("Usage: deno task start <trellisUrl> <rootSecret>");
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
  await device.request("Auth.Me", {}).orThrow();

  printScenarioHeading("Inspection operation device");
  console.info("Connected to inspection operation demo device runtime");

  const cancelledInspectionId = ASSIGNED_INSPECTIONS[0]?.inspectionId;
  const completedInspectionId = ASSIGNED_INSPECTIONS[1]?.inspectionId;
  if (!cancelledInspectionId || !completedInspectionId) {
    throw new Error("operation demo requires at least two assigned inspections");
  }

  console.info("starting cancellation flow", { inspectionId: cancelledInspectionId });
  const cancelled = await device.operation("Inspection.Report.Generate")
    .input({ inspectionId: cancelledInspectionId })
    .onEvent((event) => {
      if (event.type === "progress") {
        const progress = progressFields(event.progress);
        if (!progress) {
          return;
        }

        console.info("cancel flow progress", progress.stage, progress.message);
        return;
      }

      console.info("cancel flow event", event.type, event.snapshot.state);
    })
    .start()
    .orThrow();
  console.info("cancel flow accepted", {
    id: cancelled.id,
    operation: cancelled.operation,
  });

  await sleep(700);

  const cancelledSnapshot = await cancelled.cancel().orThrow();
  console.info("cancel flow cancel()", cancelledSnapshot.state);

  const cancelledTerminal = await cancelled.wait().orThrow();
  console.info("cancel flow wait()", cancelledTerminal.state);

  console.info("starting completion flow", { inspectionId: completedInspectionId });
  const completed = await device.operation("Inspection.Report.Generate")
    .input({ inspectionId: completedInspectionId })
    .onEvent((event) => {
      if (event.type === "progress") {
        const progress = progressFields(event.progress);
        if (!progress) {
          return;
        }

        console.info("completion flow progress", progress.stage, progress.message);
        return;
      }

      console.info("completion flow event", event.type, event.snapshot.state);
    })
    .start()
    .orThrow();
  console.info("completion flow accepted", {
    id: completed.id,
    operation: completed.operation,
  });

  const completedTerminal = await completed.wait().orThrow();
  console.info("completion flow wait()", completedTerminal.state);
  console.info("completion flow output", completedTerminal.output);
}

if (import.meta.main) {
  await main();
}
