import type { TrellisConsoleClient } from "../../../../../generated/js/sdks/console/client.ts";
import contract from "./contract.ts";
import { APP_CONFIG } from "./config.ts";
import { getConnection, getTrellis } from "./trellis-context.svelte.ts";
export {
  getAuthenticatedUser,
  logoutAuthenticatedUser,
} from "./trellis-context.svelte.ts";

export { contract, getConnection, getTrellis };

export type AppTrellis = TrellisConsoleClient;
export type ConnectionStatus = ReturnType<typeof getConnection>["status"];

export const trellisUrl = APP_CONFIG.authUrl;
