import { createTrellisApp } from "@qlever-llc/trellis-svelte";
import type { TrellisDemoAppClient } from "../../../generated/js/sdks/demo-app/client.ts";
import contract from "../../contract.ts";

export const trellisApp = createTrellisApp<
  typeof contract,
  TrellisDemoAppClient
>(contract);
