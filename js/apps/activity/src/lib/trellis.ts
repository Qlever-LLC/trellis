import type {
  ActivityGetInput,
  ActivityGetOutput,
  ActivityListInput,
  ActivityListOutput,
} from "@qlever-llc/trellis/sdk/activity";
import type {
  AuthLogoutInput,
  AuthLogoutOutput,
  AuthMeInput,
  AuthMeOutput,
} from "@qlever-llc/trellis/sdk/auth";
import { createAuthState, getTrellis as getTrellisContext } from "@qlever-llc/trellis-svelte";
import { activityApp } from "../../contracts/activity_app.ts";
import { APP_CONFIG } from "./config.ts";

type AppTrellis = {
  requestOrThrow(method: "Auth.Me", input: AuthMeInput): Promise<AuthMeOutput>;
  requestOrThrow(method: "Auth.Logout", input: AuthLogoutInput): Promise<AuthLogoutOutput>;
  requestOrThrow(method: "Activity.Get", input: ActivityGetInput): Promise<ActivityGetOutput>;
  requestOrThrow(method: "Activity.List", input: ActivityListInput): Promise<ActivityListOutput>;
};

export const auth = createAuthState({
  authUrl: APP_CONFIG.authUrl,
  contract: activityApp,
  loginPath: "/login",
});

export function getTrellis() {
  return getTrellisContext<AppTrellis>();
}
