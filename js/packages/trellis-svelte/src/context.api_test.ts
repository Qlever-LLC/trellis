import type { BoundTrellisApp } from "./context.svelte.ts";
import type { BaseError, Result } from "@qlever-llc/result";
import type { ActivityListOutput } from "@qlever-llc/trellis/sdk/activity";
import type { AuthMeOutput } from "@qlever-llc/trellis/sdk/auth";

type DemoContract = typeof import("../../../apps/activity/src/contracts/activity_app.ts").activityApp;

declare const app: BoundTrellisApp<DemoContract>;

const authUrl: string | null = app.auth.authUrl;
const signInResult: Promise<never> = app.signIn({ authUrl: "http://localhost:4000", landingPath: "/dashboard" });
const typedTrellis = app.getTrellis();
const typedRequest: Promise<Result<ActivityListOutput, BaseError>> = typedTrellis.then((trellis) =>
  trellis.request("Activity.List", {})
);
const typedRequestOrThrow: Promise<AuthMeOutput> = typedTrellis.then((trellis) =>
  trellis.requestOrThrow("Auth.Me", {})
);

void authUrl;
void signInResult;
void typedTrellis;
void typedRequest;
void typedRequestOrThrow;
