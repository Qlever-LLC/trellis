import { createTrellisApp } from "@qlever-llc/trellis-svelte";
import type { TrellisClientFor } from "@qlever-llc/trellis-svelte";
import contract from "./contract.ts";

export const trellisApp = createTrellisApp(contract);

export function getTrellis<TClient = TrellisClientFor<typeof contract>>(): TClient {
  return trellisApp.getTrellis<TClient>();
}

export const getConnection = trellisApp.getConnection.bind(trellisApp);
