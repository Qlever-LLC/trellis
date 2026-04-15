import { defineAppContract } from "@qlever-llc/trellis/contracts";
import { activity } from "@qlever-llc/trellis-sdk/activity";
import { auth as trellisAuth } from "@qlever-llc/trellis-sdk/auth";

export const activityApp = defineAppContract(
  () => ({
    id: "trellis.activity-app@v1",
    displayName: "Activity App",
    description: "Drive the activity UI's authenticated access to Trellis and activity RPCs.",
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
  }),
);

export const CONTRACT_ID = activityApp.CONTRACT_ID;
export const CONTRACT = activityApp.CONTRACT;
export const CONTRACT_DIGEST = activityApp.CONTRACT_DIGEST;
export const API: typeof activityApp.API = activityApp.API;
export const use: typeof activityApp.use = activityApp.use;
export default activityApp;
