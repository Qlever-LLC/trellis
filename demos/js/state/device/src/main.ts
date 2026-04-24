import { TrellisDevice } from "@qlever-llc/trellis";
import { checkDeviceActivation } from "@qlever-llc/trellis/device/deno";
import contract from "../contract.ts";
import { renderCompactQr } from "../../../shared/compact_qr.ts";
import { ASSIGNED_INSPECTIONS } from "../../../shared/field_data.ts";
import { Command } from "@cliffy/command";
import chalk from "chalk";

async function main(): Promise<void> {
  const {
    args: [trellisUrl, rootSecret],
  } = await new Command()
    .name("demo-state")
    .arguments("<trellisUrl:string> <rootSecret:string>", [
      "URL of Trellis instance to connect to",
      "Trellis device root secret",
    ])
    .parse(Deno.args);

  const activation = await checkDeviceActivation({
    trellisUrl,
    contract,
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
    trellisUrl,
    contract,
    rootSecret,
  }).orThrow();
  console.log(chalk.green.bold("== Fetching Current Identify"));

  const me = await device.request("Auth.Me", {}).orThrow();
  console.dir(me, { depth: null });

  const selectedInspection = ASSIGNED_INSPECTIONS[0];
  const draftInspections = ASSIGNED_INSPECTIONS.slice(0, 2);
  if (!selectedInspection || draftInspections.length < 2) {
    throw new Error("state demo requires at least two assigned inspections");
  }

  const selectedSite = {
    siteId: selectedInspection.siteId,
    siteName: selectedInspection.siteName,
    selectedAt: new Date().toISOString(),
  };
  const drafts = draftInspections.map((inspection, index) => ({
    inspectionId: inspection.inspectionId,
    siteId: inspection.siteId,
    checklistName: inspection.checklistName,
    notes: index === 0
      ? "Found minor seepage near valve housing. Follow-up photo still pending."
      : "Generator battery terminals cleaned. Run test completed without alarms.",
    updatedAt: new Date(Date.now() + index * 60_000).toISOString(),
  }));

  await device.state.selectedSite.put(selectedSite).orThrow();

  for (const draft of drafts) {
    await device.state.draftInspections.put(
      draft.inspectionId,
      draft,
    ).orThrow();
  }

  const selectedSiteEntry = await device.state.selectedSite.get().orThrow();
  const firstDraftEntry = await device.state.draftInspections.get(
    drafts[0].inspectionId,
  ).orThrow();
  const listedEntries = await device.state.draftInspections.list({
    limit: 10,
  }).orThrow();

  console.log(chalk.green.bold("== Selected Site State"));
  console.info("Selected site state");
  console.dir(selectedSiteEntry, { depth: null });
  console.log(chalk.green.bold("== Draft Inspection State"));
  console.info("Draft inspection state");
  console.dir(firstDraftEntry, { depth: null });
  console.log(chalk.green.bold("== Listed Device State"));
  console.info("Listed device state");
  console.dir(listedEntries, { depth: null });

  await device.natsConnection.close();
}

if (import.meta.main) {
  await main();
}
