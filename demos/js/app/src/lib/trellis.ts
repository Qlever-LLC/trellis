import { env } from "$env/dynamic/public";
import {
  createTrellisApp,
  type TrellisClientFor,
} from "@qlever-llc/trellis-svelte";
import contract from "../../contract.ts";

export type TrellisDemoAppClient = TrellisClientFor<typeof contract>;

if (!env.PUBLIC_TRELLIS_URL) {
  throw new Error("Missing TRELLIS_URL env. Please define it.");
}

export const trellisUrl = new URL(env.PUBLIC_TRELLIS_URL.trim())
  .toString()
  .replace(/\/$/, "");

export { contract };

export const trellisApp = createTrellisApp({ contract, trellisUrl });

export function getTrellis(): TrellisDemoAppClient {
  return trellisApp.getTrellis();
}

export function getConnection() {
  return trellisApp.getConnection();
}
