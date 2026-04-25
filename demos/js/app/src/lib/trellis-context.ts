import { createTrellisApp } from "@qlever-llc/trellis-svelte";
import type { TrellisDemoAppClient } from "../../../generated/js/sdks/demo-app/client.ts";
import contract from "../../contract.ts";

export { contract };
export const trellisApp = createTrellisApp<
  typeof contract,
  TrellisDemoAppClient
>(contract);

export function getTrellis(): TrellisDemoAppClient {
  return trellisApp.getTrellis();
}

export function getConnection() {
  return trellisApp.getConnection();
}
