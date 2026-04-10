import { createTrellisApp } from "@qlever-llc/trellis-svelte";
import { trellisApp } from "../contracts/trellis_app.ts";
import { APP_CONFIG } from "./config.ts";

export const app = createTrellisApp({
  authUrl: APP_CONFIG.authUrl,
  contract: trellisApp,
  loginPath: "/login",
});

export const getTrellis = app.getTrellis;
