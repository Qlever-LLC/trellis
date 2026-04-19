import { isErr, TrellisDevice } from "@qlever-llc/trellis";
import contract from "../contracts/demo_inspection_state_device.ts";
import { ASSIGNED_INSPECTIONS } from "../../../shared/field_data.ts";
import { printJson, printScenarioHeading } from "../../../shared/logging.ts";

const trellisUrl = Deno.args[0]?.trim();
const rootSecret = Deno.args[1]?.trim();
const scope = "deviceApp" as const;

type SelectedSiteState = {
  siteId: string;
  siteName: string;
  selectedAt: string;
};

type DraftInspectionState = {
  inspectionId: string;
  siteId: string;
  checklistName: string;
  notes: string;
  updatedAt: string;
};

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

  printScenarioHeading("Inspection state device");
  console.info("Connected as", me.device?.deviceId ?? "unknown-device");

  const selectedInspection = ASSIGNED_INSPECTIONS[0];
  const draftInspections = ASSIGNED_INSPECTIONS.slice(0, 2);
  if (!selectedInspection || draftInspections.length < 2) {
    throw new Error("state demo requires at least two assigned inspections");
  }

  const selectedSite: SelectedSiteState = {
    siteId: selectedInspection.siteId,
    siteName: selectedInspection.siteName,
    selectedAt: new Date().toISOString(),
  };
  const drafts: DraftInspectionState[] = draftInspections.map((inspection, index) => ({
    inspectionId: inspection.inspectionId,
    siteId: inspection.siteId,
    checklistName: inspection.checklistName,
    notes: index === 0
      ? "Found minor seepage near valve housing. Follow-up photo still pending."
      : "Generator battery terminals cleaned. Run test completed without alarms.",
    updatedAt: new Date(Date.now() + index * 60_000).toISOString(),
  }));

  const selectedSitePut = (await device.request("State.Put", {
    scope,
    key: "selected-site",
    value: selectedSite,
  })).take();
  if (isErr(selectedSitePut)) {
    throw selectedSitePut.error;
  }

  for (const draft of drafts) {
    const draftPut = (await device.request("State.Put", {
      scope,
      key: `draft-inspection/${draft.inspectionId}`,
      value: draft,
    })).take();
    if (isErr(draftPut)) {
      throw draftPut.error;
    }
  }

  const selectedSiteEntry = (await device.request("State.Get", {
    scope,
    key: "selected-site",
  })).take();
  if (isErr(selectedSiteEntry)) {
    throw selectedSiteEntry.error;
  }

  const firstDraftEntry = (await device.request("State.Get", {
    scope,
    key: `draft-inspection/${drafts[0].inspectionId}`,
  })).take();
  if (isErr(firstDraftEntry)) {
    throw firstDraftEntry.error;
  }

  const listedEntries = (await device.request("State.List", {
    scope,
    offset: 0,
    limit: 10,
  })).take();
  if (isErr(listedEntries)) {
    throw listedEntries.error;
  }

  printJson("Selected site state", selectedSiteEntry);
  printJson("Draft inspection state", firstDraftEntry);
  printJson("Listed device state", listedEntries);
}

if (import.meta.main) {
  await main();
}
