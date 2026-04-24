import { createTrellisApp } from "@qlever-llc/trellis-svelte";
import contract from "../../contract.ts";

export const trellisApp = createTrellisApp(contract);
