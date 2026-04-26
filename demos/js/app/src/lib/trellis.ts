import { env } from "$env/dynamic/public";
import { createTrellisApp } from "@qlever-llc/trellis-svelte";
import type { TrellisDemoAppClient } from "../../../generated/js/sdks/demo-app/client.ts";
import contract from "../../contract.ts";

if (!env.PUBLIC_TRELLIS_URL) {
  throw new Error("Missing TRELLIS_URL env. Please define it.");
}

export const trellisUrl = new URL(env.PUBLIC_TRELLIS_URL.trim())
  .toString()
  .replace(/\/$/, "");

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
