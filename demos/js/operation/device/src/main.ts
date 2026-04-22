import { TrellisDevice } from "@qlever-llc/trellis";
import contract from "../contract.ts";
import { ASSIGNED_INSPECTIONS } from "../../../shared/field_data.ts";
import { Command } from "@cliffy/command";
import { qrcode } from "@libs/qrcode";
import chalk from "chalk";

async function main(): Promise<void> {
  const {
    args: [trellisUrl, rootSecret],
  } = await new Command()
    .name("demo-operation")
    .arguments("<trellisUrl:string> <rootSecret:string>", [
      "URL of Trellis instance to connect to",
      "Trellis device root secret",
    ])
    .parse(Deno.args);

  const device = await TrellisDevice.connect({
    trellisUrl,
    contract,
    rootSecret,
    onActivationRequired: async (activation) => {
      console.info("Please activate device at:", activation.url);
      qrcode(activation.url, { output: "console" });

      await activation.waitForOnlineApproval();
    },
  }).orThrow();
  console.log(chalk.green.bold("== Fetching Current Identify"));

  const me = await device.request("Auth.Me", {}).orThrow();
  console.dir(me, { depth: null });

  const cancelledInspectionId = ASSIGNED_INSPECTIONS[0]?.inspectionId;
  const completedInspectionId = ASSIGNED_INSPECTIONS[1]?.inspectionId;
  if (!cancelledInspectionId || !completedInspectionId) {
    throw new Error("operation demo requires at least two assigned inspections");
  }

  console.log(chalk.green.bold("== Starting Cancellation Flow"));
  console.info("starting cancellation flow", { inspectionId: cancelledInspectionId });
  const cancelled = await device.operation("Inspection.Report.Generate")
    .input({ inspectionId: cancelledInspectionId })
    .onEvent((event) => {
      if (event.type === "progress") {
        console.info("cancel flow progress", event.progress);
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

  await new Promise((resolve) => setTimeout(resolve, 700));

  const cancelledSnapshot = await cancelled.cancel().orThrow();
  console.info("cancel flow cancel()", cancelledSnapshot.state);

  const cancelledTerminal = await cancelled.wait().orThrow();
  console.info("cancel flow wait()", cancelledTerminal.state);

  console.log(chalk.green.bold("== Starting Completion Flow"));
  console.info("starting completion flow", { inspectionId: completedInspectionId });
  const completed = await device.operation("Inspection.Report.Generate")
    .input({ inspectionId: completedInspectionId })
    .onEvent((event) => {
      if (event.type === "progress") {
        console.info("completion flow progress", event.progress);
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
