import { defineAppContract } from "@qlever-llc/trellis/contracts";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import { sdk as trellisHealth } from "@qlever-llc/trellis/sdk/health";
import { sdk as trellisJobs } from "@qlever-llc/trellis/sdk/jobs";

export const contract = defineAppContract(
  () => ({
    id: "trellis.console@v1",
    displayName: "Trellis Console",
    description:
      "Drive the Trellis admin console's contract-declared Auth, Health, and Jobs access.",
    uses: {
      required: {
        auth: trellisAuth.use({
          rpc: {
            call: [
              "Auth.Deployments.Create",
              "Auth.DeviceUserAuthorities.Reviews.Decide",
              "Auth.Devices.Disable",
              "Auth.ServiceInstances.Disable",
              "Auth.Deployments.Disable",
              "Auth.Devices.Enable",
              "Auth.ServiceInstances.Enable",
              "Auth.Deployments.Enable",
              "Auth.Envelopes.Changes.Preview",
              "Auth.EnvelopeExpansions.Approve",
              "Auth.EnvelopeExpansions.List",
              "Auth.EnvelopeExpansions.Reject",
              "Auth.Envelopes.Expand",
              "Auth.Envelopes.GrantOverrides.Put",
              "Auth.Envelopes.GrantOverrides.Remove",
              "Auth.Envelopes.Get",
              "Auth.Envelopes.List",
              "Auth.Envelopes.Shrink",
              "Auth.Connections.Kick",
              "Auth.Identities.List",
              "Auth.Capabilities.List",
              "Auth.CapabilityGroups.Delete",
              "Auth.CapabilityGroups.List",
              "Auth.CapabilityGroups.Put",
              "Auth.Connections.List",
              "Auth.DeviceUserAuthorities.Reviews.List",
              "Auth.DeviceUserAuthorities.List",
              "Auth.Devices.List",
              "Auth.Deployments.List",
              "Auth.Sessions.Logout",
              "Auth.Sessions.Me",
              "Auth.ServiceInstances.List",
              "Auth.Sessions.List",
              "Auth.Identities.Grants.List",
              "Auth.UserIdentities.List",
              "Auth.Users.List",
              "Auth.Users.Create",
              "Auth.AccountFlows.CreateIdentityLink",
              "Auth.AccountFlows.CreatePasswordReset",
              "Auth.AccountFlows.CreatePasswordSetup",
              "Auth.Devices.Provision",
              "Auth.ServiceInstances.Provision",
              "Auth.Devices.Remove",
              "Auth.Deployments.Remove",
              "Auth.IdentityEnvelopes.Revoke",
              "Auth.DeviceUserAuthorities.Revoke",
              "Auth.Sessions.Revoke",
              "Auth.IdentityEnvelopes.Revoke",
              "Auth.ServiceInstances.Remove",
              "Auth.Users.Update",
              "Auth.Portals.List",
              "Auth.Portals.Put",
              "Auth.Portals.Remove",
              "Auth.Portals.LoginSettings.Get",
              "Auth.Portals.LoginSettings.Update",
              "Auth.Portals.LoginRoutes.List",
              "Auth.Portals.LoginRoutes.Put",
              "Auth.Portals.LoginRoutes.Remove",
            ],
          },
        }),
        health: trellisHealth.use({
          events: {
            subscribe: ["Health.Heartbeat"],
          },
        }),
        jobs: trellisJobs.use({
          rpc: {
            call: [
              "Jobs.Get",
              "Jobs.Cancel",
              "Jobs.Retry",
              "Jobs.List",
              "Jobs.ListServices",
              "Jobs.ListDLQ",
              "Jobs.ReplayDLQ",
              "Jobs.DismissDLQ",
            ],
          },
        }),
      },
    },
  }),
);

export default contract;
