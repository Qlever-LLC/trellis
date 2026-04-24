import { createTrellisApp } from "@qlever-llc/trellis-svelte";
import type { TrellisConsoleClient } from "../../../../../generated/js/sdks/console/client.ts";
import contract from "./contract.ts";

export const trellisApp = createTrellisApp<
  typeof contract,
  TrellisConsoleClient
>(contract);

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
