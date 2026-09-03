import {
  createTrellisApp,
  type TrellisClientFor,
} from "@qlever-llc/trellis-svelte";
import contract from "../../contracts/console/contract.ts";
import { APP_CONFIG } from "./config.ts";

export type TrellisConsoleClient = TrellisClientFor<typeof contract>;

let selectedTrellisUrl: string | undefined = APP_CONFIG.authUrl;

/** Sets the Trellis URL selected for the console's provider connection. */
export function setSelectedTrellisUrl(trellisUrl: string | undefined): void {
  selectedTrellisUrl = trellisUrl;
}

export const trellisApp = createTrellisApp({
  contract,
  participant: {
    id: contract.CONTRACT_ID,
    artifactDigest: contract.CONTRACT_DIGEST,
  },
  trellisUrl: () => selectedTrellisUrl,
});

export function getTrellis(): TrellisConsoleClient {
  return trellisApp.getTrellis();
}

export function getAuthenticatedUser(trellis: TrellisConsoleClient) {
  return trellis.authSessionsMe({}).orThrow();
}

export function getConnection() {
  return trellisApp.getConnection();
}
