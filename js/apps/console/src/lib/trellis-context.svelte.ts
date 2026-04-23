import { createTrellisProviderContexts } from "@qlever-llc/trellis-svelte";
import { trellisApp } from "../../contracts/trellis_app.ts";

export const contexts = createTrellisProviderContexts<typeof trellisApp>();

export const getTrellis = contexts.trellis.getTrellis;
export const getAuth = contexts.auth.getAuth;
export const getConnectionState = contexts.connectionState.getConnectionState;
