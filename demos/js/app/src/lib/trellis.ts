import { createAuthState } from "@qlever-llc/trellis-svelte";
import contract from "../../contract.ts";

export const trellisUrl = "http://localhost:3000";

export const auth: ReturnType<typeof createAuthState> = createAuthState({
  authUrl: trellisUrl,
  contract,
  loginPath: "/login",
});
