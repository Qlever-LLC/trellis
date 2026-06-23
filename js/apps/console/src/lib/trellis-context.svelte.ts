import {
  createTrellisApp,
  type TrellisClientFor,
} from "@qlever-llc/trellis-svelte";
import contract from "../../contract.ts";
import { APP_CONFIG } from "./config.ts";

export type TrellisConsoleClient = TrellisClientFor<typeof contract>;

export type AuthSessionsLogoutInput = {
  browser?: {
    returnTo?: string;
    includeProviderLogout?: boolean;
    federatedProviderLogout?: boolean;
  };
};

export type AuthSessionsLogoutResponse = {
  success: boolean;
  providerLogoutUrl?: string;
};

type AuthSessionsLogoutClient = {
  request(
    subject: "Auth.Sessions.Logout",
    input: AuthSessionsLogoutInput,
  ): { orThrow(): Promise<AuthSessionsLogoutResponse> };
};

let selectedTrellisUrl: string | undefined = APP_CONFIG.authUrl;

/** Sets the Trellis URL selected for the console's provider connection. */
export function setSelectedTrellisUrl(trellisUrl: string | undefined): void {
  selectedTrellisUrl = trellisUrl;
}

export const trellisApp = createTrellisApp({
  contract,
  trellisUrl: () => selectedTrellisUrl,
});

export function getTrellis(): TrellisConsoleClient {
  return trellisApp.getTrellis();
}

export function getAuthenticatedUser(trellis: TrellisConsoleClient) {
  return trellis.request("Auth.Sessions.Me", {}).orThrow();
}

export function logoutAuthenticatedUser(
  trellis: AuthSessionsLogoutClient,
  input: AuthSessionsLogoutInput = {},
) {
  return trellis.request("Auth.Sessions.Logout", input).orThrow();
}

export function getConnection() {
  return trellisApp.getConnection();
}
