import { env } from "$env/dynamic/public";
import {
  createTrellisApp,
  type TrellisClientFor,
} from "@qlever-llc/trellis-svelte";
import contract from "../../contract.ts";

export type TrellisDemoAppClient = TrellisClientFor<typeof contract>;

const defaultTrellisUrl = "http://localhost:3000";

export const trellisUrl = new URL(
  env.PUBLIC_TRELLIS_URL?.trim() || defaultTrellisUrl,
)
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
