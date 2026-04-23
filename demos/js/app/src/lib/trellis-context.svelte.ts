import { createTrellisProviderContexts } from "@qlever-llc/trellis-svelte";
import contract from "../../contract.ts";

export const contexts = createTrellisProviderContexts<typeof contract>();

export const getTrellis = contexts.trellis.getTrellis;
export const getAuth = contexts.auth.getAuth;
export const getConnectionState = contexts.connectionState.getConnectionState;
