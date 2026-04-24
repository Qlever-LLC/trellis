import type { TrellisClientFor } from "@qlever-llc/trellis-svelte";
import contract from "./contract.ts";
import { APP_CONFIG } from "./config.ts";
import { getConnection, getTrellis } from "./trellis-context.svelte.ts";

export { contract, getConnection, getTrellis };

export type AppTrellis = TrellisClientFor<typeof contract>;
export type ConnectionStatus = ReturnType<typeof getConnection>["status"];

export const trellisUrl = APP_CONFIG.authUrl;
