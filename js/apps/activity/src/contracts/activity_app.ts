import { defineContract } from "@qlever-llc/trellis/contracts";
import { activity } from "@qlever-llc/trellis/sdk/activity";
import { auth as trellisAuth } from "@qlever-llc/trellis/sdk/auth";

export const activityApp = defineContract({
  id: "trellis.activity-app@v1",
  displayName: "Activity App",
  description: "Drive the activity UI's authenticated access to Trellis and activity RPCs.",
  kind: "app",
  uses: {
    auth: trellisAuth.use({
      rpc: {
        call: ["Auth.Me", "Auth.Logout"],
      },
    }),
    activity: activity.use({
      rpc: {
        call: ["Activity.Get", "Activity.List"],
      },
    }),
  },
});

export const { CONTRACT_ID, CONTRACT, CONTRACT_DIGEST, API, use } = activityApp;
