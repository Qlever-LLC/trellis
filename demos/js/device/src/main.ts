import { ok } from "@qlever-llc/result";
import { TrellisDevice } from "@qlever-llc/trellis";
import { checkDeviceActivation } from "@qlever-llc/trellis/device/deno";
import { TransportError } from "@qlever-llc/trellis/errors";
import chalk from "chalk";
import contract from "../contract.ts";
import { renderCompactQr } from "../../shared/compact_qr.ts";

const DEFAULT_CONTENT_TYPE = "application/octet-stream";
const EVENT_WATCH_MS = 15_000;

async function main(): Promise<void> {
  const [trellisUrl, rootSecret] = Deno.args;
  if (!trellisUrl || !rootSecret) {
    console.error("Usage: deno task start <trellisUrl> <rootSecret>");
    Deno.exit(1);
  }

  const activation = await checkDeviceActivation({
    contract,
    trellisUrl,
    rootSecret,
  });

  if (activation.status === "not_ready") {
    throw new Error(`Device is not ready: ${activation.reason}`);
  }
  if (activation.status === "activation_required") {
    console.info("Please activate device at:", activation.activationUrl);
    renderCompactQr(activation.activationUrl);
    await activation.waitForOnlineApproval();
  }

  const device = await TrellisDevice.connect({
    contract,
    trellisUrl,
    rootSecret,
  }).orThrow();

  try {
    console.log(chalk.green.bold("== Connected Field Device"));
    const me = await device.request("Auth.Me", {}).orThrow();
    console.dir(me, { depth: null });

    while (true) {
      printMenu();
      const choice = prompt("Select option")?.trim() ?? "";

      switch (choice) {
        case "1":
          await listAssignments(device);
          break;
        case "2":
          await viewSelectedSite(device);
          break;
        case "3":
          await refreshSite(device);
          break;
        case "4":
          await generateReport(device);
          break;
        case "5":
          await uploadEvidence(device);
          break;
        case "6":
          await watchActivity(device);
          break;
        case "7":
          await saveAndListDraftState(device);
          break;
        case "0":
          return;
        default:
          console.info("Choose a menu number from 0 through 7.");
      }
    }
  } finally {
    await device.natsConnection.close();
  }
}

type Device = Awaited<ReturnType<typeof connectForTypes>>;

async function connectForTypes() {
  return await TrellisDevice.connect({
    contract,
    trellisUrl: "http://localhost:0",
    rootSecret: "types-only",
  }).orThrow();
}

function printMenu(): void {
  console.log(chalk.cyan.bold("\nField Device Demo"));
  console.log("1. List assigned inspections");
  console.log("2. View selected site");
  console.log("3. Refresh site summary");
  console.log("4. Generate inspection report");
  console.log("5. Upload evidence file");
  console.log("6. Watch activity events briefly");
  console.log("7. Save/list draft state");
  console.log("0. Quit");
}

async function listAssignments(device: Device): Promise<void> {
  console.log(chalk.green.bold("== Assigned Inspections"));
  const result = await device.request("Assignments.List", {}).orThrow();

  if (result.assignments.length === 0) {
    console.info("No assigned inspections.");
    return;
  }

  for (const item of result.assignments) {
    console.info(
      `- ${item.inspectionId}: [${item.priority.toUpperCase()}] ${item.siteName} / ${item.assetName} (${item.checklistName}) at ${item.scheduledFor}`,
    );
  }
}

async function viewSelectedSite(device: Device): Promise<void> {
  console.log(chalk.green.bold("== Selected Site"));
  const selected = await device.state.selectedSite.get().orThrow();
  if (!selected.found) {
    console.info("No selected site saved. Use option 7 to save one.");
    return;
  }

  const result = await device.request("Sites.Get", {
    siteId: selected.entry.value.siteId,
  }).orThrow();

  if (!result.site) {
    console.info(`Selected site ${selected.entry.value.siteId} was not found.`);
    return;
  }

  printSite(result.site);
}

async function refreshSite(device: Device): Promise<void> {
  const siteId = prompt("Site ID to refresh")?.trim();
  if (!siteId) {
    console.info("Refresh skipped: site ID is required.");
    return;
  }

  console.log(chalk.green.bold("== Refreshing Site Summary"));
  const operation = await device.operation("Sites.Refresh")
    .input({ siteId })
    .start()
    .orThrow();
  console.info(`Accepted refresh operation ${operation.id}`);

  const events = await operation.watch().orThrow();
  for await (const event of events) {
    printOperationEvent(event);
    if (
      event.type === "completed" || event.type === "failed" ||
      event.type === "cancelled"
    ) {
      break;
    }
  }

  const terminal = await operation.wait().orThrow();
  console.info("Refresh finished:");
  console.dir(terminal.output, { depth: null });
}

async function generateReport(device: Device): Promise<void> {
  const inspectionId = prompt("Inspection ID")?.trim();
  if (!inspectionId) {
    console.info("Report skipped: inspection ID is required.");
    return;
  }

  console.log(chalk.green.bold("== Generating Inspection Report"));
  const operation = await device.operation("Reports.Generate")
    .input({ inspectionId })
    .start()
    .orThrow();
  console.info(`Accepted report operation ${operation.id}`);

  const cancel = prompt("Cancel after a short delay? [y/N]")?.trim()
    .toLowerCase();
  if (cancel === "y" || cancel === "yes") {
    setTimeout(() => {
      void operation.cancel().match({
        ok: (snapshot: { state: string }) => {
          console.info(`Cancel requested; current state is ${snapshot.state}`);
        },
        err: (error: Error) => {
          console.error("Cancel request failed:", error.message);
        },
      });
    }, 500);
  }

  const events = await operation.watch().orThrow();
  for await (const event of events) {
    printOperationEvent(event);
    if (
      event.type === "completed" || event.type === "failed" ||
      event.type === "cancelled"
    ) {
      break;
    }
  }

  const terminal = await operation.wait().orThrow();
  console.info("Report operation finished:");
  console.dir(terminal.output, { depth: null });
}

async function uploadEvidence(device: Device): Promise<void> {
  const filePath = prompt("Evidence file path")?.trim();
  if (!filePath) {
    console.info("Upload skipped: file path is required.");
    return;
  }

  const bytes = await Deno.readFile(filePath);
  const fileName = filePath.split(/[\\/]/).at(-1) || "evidence.bin";
  const key = `evidence/${crypto.randomUUID()}-${fileName}`;
  let nextProgressPercent = 0;

  console.log(chalk.green.bold("== Uploading Evidence"));
  console.info(`Uploading ${bytes.length} bytes to ${key}`);

  const upload = await device.operation("Evidence.Upload")
    .input({
      key,
      contentType: DEFAULT_CONTENT_TYPE,
      evidenceType: "field-photo",
    })
    .transfer(bytes)
    .onTransfer((event: { transfer: { transferredBytes: number } }) => {
      const percent = Math.floor(
        event.transfer.transferredBytes / Math.max(bytes.length, 1) * 100,
      );
      if (percent >= nextProgressPercent) {
        console.info(
          `transfer ${percent}% (${event.transfer.transferredBytes}/${bytes.length} bytes)`,
        );
        nextProgressPercent = Math.min(100, percent + 10);
      }
    })
    .onProgress((event: { progress: { stage: string; message: string } }) => {
      console.info(
        `service ${event.progress.stage}: ${event.progress.message}`,
      );
    })
    .start()
    .orThrow();

  console.info(`Accepted upload operation ${upload.operation.id}`);
  const completed = await upload.wait().orThrow();
  console.info("Upload finished:");
  console.dir(completed.terminal.output, { depth: null });
}

async function watchActivity(device: Device): Promise<void> {
  console.log(chalk.green.bold("== Watching Events"));
  console.info(
    `Watching new activity and report events for ${EVENT_WATCH_MS / 1000}s.`,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EVENT_WATCH_MS);

  try {
    await device.event(
      "Activity.Recorded",
      {},
      (event) => {
        console.info("Activity.Recorded");
        console.dir(event, { depth: null });
        return ok(undefined);
      },
      { mode: "ephemeral", replay: "new", signal: controller.signal },
    ).orThrow();
    await device.event(
      "Reports.Published",
      {},
      (event) => {
        console.info("Reports.Published");
        console.dir(event, { depth: null });
        return ok(undefined);
      },
      { mode: "ephemeral", replay: "new", signal: controller.signal },
    ).orThrow();

    await new Promise((resolve) => setTimeout(resolve, EVENT_WATCH_MS));
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function saveAndListDraftState(device: Device): Promise<void> {
  console.log(chalk.green.bold("== Draft State"));
  const assignments =
    (await device.request("Assignments.List", {}).orThrow()).assignments;
  const selected = assignments[0];
  if (!selected) {
    console.info("No assignments available for sample state.");
    return;
  }

  await device.state.selectedSite.put({
    siteId: selected.siteId,
    siteName: selected.siteName,
    selectedAt: new Date().toISOString(),
  }).orThrow();

  const notes = prompt("Draft notes")?.trim() ||
    "Field notes captured from the consolidated device demo.";
  await device.state.draftInspections.put(selected.inspectionId, {
    inspectionId: selected.inspectionId,
    siteId: selected.siteId,
    checklistName: selected.checklistName,
    notes,
    updatedAt: new Date().toISOString(),
  }).orThrow();

  const selectedSite = await device.state.selectedSite.get().orThrow();
  const drafts = await device.state.draftInspections.list({ limit: 10 })
    .orThrow();

  console.info("Selected site state:");
  console.dir(selectedSite, { depth: null });
  console.info("Draft inspection state:");
  console.dir(drafts, { depth: null });
}

function printSite(site: {
  siteId: string;
  siteName: string;
  openInspections: number;
  overdueInspections: number;
  latestStatus: string;
  lastReportAt: string;
}): void {
  console.info(
    `- ${site.siteName} (${site.siteId}): ${site.openInspections} open, ${site.overdueInspections} overdue, status ${site.latestStatus}, last report ${site.lastReportAt}`,
  );
}

function printOperationEvent(event: {
  type: string;
  progress?: { stage: string; message: string };
  snapshot: { state: string };
}): void {
  if (event.type === "progress" && event.progress) {
    console.info(`${event.progress.stage}: ${event.progress.message}`);
    return;
  }

  console.info(`${event.type}: ${event.snapshot.state}`);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.error(chalk.red.bold("File not found"));
      console.error(error.message);
      Deno.exit(1);
    }
    if (error instanceof TransportError) {
      console.error(chalk.red.bold("Trellis request failed"));
      console.error(`${error.message} (${error.code})`);
      console.error(error.hint);
      Deno.exit(1);
    }

    throw error;
  }
}
