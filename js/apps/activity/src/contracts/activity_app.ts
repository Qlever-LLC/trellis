import { defineContract } from "@trellis/contracts";
import { activity } from "@trellis/sdk-activity";
import { auth as trellisAuth } from "@trellis/sdk-auth";

export const activityApp = defineContract({
  id: "trellis.activity-app@v1",
  displayName: "Activity App",
  description: "Drive the activity UI's authenticated access to Trellis and activity RPCs.",
  kind: "app",
  uses: {
    auth: trellisAuth.use({
      rpc: {
        call: ["Auth.Me"],
      },
    }),
    activity: activity.use({
      rpc: {
        call: ["Activity.Get", "Activity.List"],
      },
    }),
  },
});
