import { defineAppContract } from "@qlever-llc/trellis";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import { sdk as trellisCore } from "@qlever-llc/trellis/sdk/core";
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
              "Auth.CatalogIssues.Resolve",
              "Auth.DeviceUserAuthorities.Reviews.Decide",
              "Auth.Devices.Disable",
              "Auth.ServiceInstances.Disable",
              "Auth.Deployments.Disable",
              "Auth.Devices.Enable",
              "Auth.ServiceInstances.Enable",
              "Auth.Deployments.Enable",
              "Auth.DeploymentAuthority.List",
              "Auth.DeploymentAuthority.Get",
              "Auth.DeploymentAuthority.Plans.List",
              "Auth.DeploymentAuthority.Plans.Get",
              "Auth.DeploymentAuthority.Plan",
              "Auth.DeploymentAuthority.AcceptUpdate",
              "Auth.DeploymentAuthority.AcceptMigration",
              "Auth.DeploymentAuthority.Reject",
              "Auth.DeploymentAuthority.Reconcile",
              "Auth.DeploymentAuthority.GrantOverrides.Put",
              "Auth.DeploymentAuthority.GrantOverrides.List",
              "Auth.DeploymentAuthority.GrantOverrides.Remove",
              "Auth.Connections.Kick",
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
              "Auth.IdentityGrants.List",
              "Auth.UserIdentities.List",
              "Auth.Users.List",
              "Auth.Users.Create",
              "Auth.Users.IdentityLink.Create",
              "Auth.Users.Password.Change",
              "Auth.Users.PasswordReset.Create",
              "Auth.Devices.Provision",
              "Auth.ServiceInstances.Provision",
              "Auth.Devices.Remove",
              "Auth.Deployments.Remove",
              "Auth.IdentityGrants.Revoke",
              "Auth.DeviceUserAuthorities.Revoke",
              "Auth.Sessions.Revoke",
              "Auth.ServiceInstances.Remove",
              "Auth.Users.Update",
              "Auth.Portals.List",
              "Auth.Portals.Get",
              "Auth.Portals.Put",
              "Auth.Portals.Remove",
              "Auth.Portals.LoginSettings.Get",
              "Auth.Portals.LoginSettings.Update",
              "Auth.Portals.Routes.Put",
              "Auth.Portals.Routes.Remove",
            ],
          },
        }),
        core: trellisCore.use({
          rpc: {
            call: ["Trellis.Catalog", "Trellis.Contract.Get"],
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
