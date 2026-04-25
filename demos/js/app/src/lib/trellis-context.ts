import type { ConnectedTrellisClient } from "@qlever-llc/trellis";
import { createContext } from "svelte";
import contract from "../../contract.ts";

export { contract };
export const [getTrellis, setTrellis] = createContext<
  ConnectedTrellisClient<typeof contract>
>();
