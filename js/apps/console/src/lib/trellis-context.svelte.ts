import { createTrellisApp } from "@qlever-llc/trellis-svelte";
import type { TrellisConsoleClient } from "../../../../../generated/js/sdks/console/client.ts";
import contract from "../../contract.ts";
import { APP_CONFIG } from "./config.ts";

let selectedTrellisUrl: string | undefined = APP_CONFIG.authUrl;

/** Sets the Trellis URL selected for the console's provider connection. */
export function setSelectedTrellisUrl(trellisUrl: string | undefined): void {
  selectedTrellisUrl = trellisUrl;
}

export const trellisApp = createTrellisApp<
  typeof contract,
  TrellisConsoleClient
>({ contract, trellisUrl: () => selectedTrellisUrl });

export function getTrellis(): TrellisConsoleClient {
  return trellisApp.getTrellis();
}

export function getAuthenticatedUser(trellis: TrellisConsoleClient) {
  return trellis.request("Auth.Me", {}).orThrow();
}

export function logoutAuthenticatedUser(trellis: TrellisConsoleClient) {
  return trellis.request("Auth.Logout", {}).orThrow();
}

export function getConnection() {
  return trellisApp.getConnection();
}
