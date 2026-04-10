import { createTrellisApp } from "@qlever-llc/trellis-svelte";
import { activityApp } from "../contracts/activity_app.ts";
import { APP_CONFIG } from "./config.ts";

export const app = createTrellisApp({
  authUrl: APP_CONFIG.authUrl,
  contract: activityApp,
  loginPath: "/login",
});

export const getTrellis = app.getTrellis;
