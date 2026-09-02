import { type CallerRuntime, defineAppContract } from "@qlever-llc/trellis";
import {
  CONTRACT_RUNTIME,
  participantDigest,
} from "@qlever-llc/trellis/contracts";
import {
  AuthCapabilityGroupsPut,
  AuthCapabilityGroupsPutRequestSchema,
  AuthCapabilityGroupsPutResponseSchema,
  AuthConnectionsList,
  AuthConnectionsListRequestSchema,
  AuthConnectionsListResponseSchema,
  AuthDeploymentAuthorityAcceptMigration,
  AuthDeploymentAuthorityAcceptMigrationRequestSchema,
  AuthDeploymentAuthorityAcceptMigrationResponseSchema,
  AuthDeploymentAuthorityAcceptUpdate,
  AuthDeploymentAuthorityAcceptUpdateRequestSchema,
  AuthDeploymentAuthorityAcceptUpdateResponseSchema,
  AuthDeploymentAuthorityGet,
  AuthDeploymentAuthorityGetRequestSchema,
  AuthDeploymentAuthorityGetResponseSchema,
  AuthDeploymentAuthorityList,
  AuthDeploymentAuthorityListRequestSchema,
  AuthDeploymentAuthorityListResponseSchema,
  AuthDeploymentAuthorityPlan,
  AuthDeploymentAuthorityPlanRequestSchema,
  AuthDeploymentAuthorityPlanResponseSchema,
  AuthDeploymentAuthorityPlansList,
  AuthDeploymentAuthorityPlansListRequestSchema,
  AuthDeploymentAuthorityPlansListResponseSchema,
  AuthDeploymentAuthorityReconcile,
  AuthDeploymentAuthorityReconcileRequestSchema,
  AuthDeploymentAuthorityReconcileResponseSchema,
  AuthDeploymentAuthorityReject,
  AuthDeploymentAuthorityRejectRequestSchema,
  AuthDeploymentAuthorityRejectResponseSchema,
  AuthDeploymentsCreate,
  AuthDeploymentsCreateRequestSchema,
  AuthDeploymentsCreateResponseSchema,
  AuthDevicesProvision,
  AuthDevicesProvisionRequestSchema,
  AuthDevicesProvisionResponseSchema,
  AuthIdentityAuthorityList,
  AuthIdentityAuthorityRevoke,
  AuthPortalsGet,
  AuthPortalsGetRequestSchema,
  AuthPortalsGetResponseSchema,
  AuthPortalsGrantOverridesPut,
  AuthPortalsGrantOverridesPutRequestSchema,
  AuthPortalsGrantOverridesPutResponseSchema,
  AuthPortalsGrantOverridesRemove,
  AuthPortalsGrantOverridesRemoveRequestSchema,
  AuthPortalsGrantOverridesRemoveResponseSchema,
  AuthPortalsList,
  AuthPortalsListRequestSchema,
  AuthPortalsListResponseSchema,
  AuthPortalsLoginSettingsGetResponseSchema,
  AuthPortalsLoginSettingsUpdate,
  AuthPortalsLoginSettingsUpdateRequestSchema,
  AuthPortalsPut,
  AuthPortalsPutRequestSchema,
  AuthPortalsPutResponseSchema,
  AuthPortalsRoutesPut,
  AuthPortalsRoutesPutRequestSchema,
  AuthPortalsRoutesPutResponseSchema,
  AuthServiceInstancesProvision,
  AuthServiceInstancesProvisionRequestSchema,
  AuthServiceInstancesProvisionResponseSchema,
  AuthSessionsRevoke,
  AuthSessionsRevokeRequestSchema,
  AuthSessionsRevokeResponseSchema,
  AuthUserIdentitiesList,
} from "@trellis/apis/trellis.auth";
import { EventLogQuery } from "@trellis/apis/trellis.eventlog";
import { HealthQuery } from "@trellis/apis/trellis.health";
import { JobsQuery } from "@trellis/apis/trellis.jobs";
import {
  StateAdminDelete,
  StateAdminDeleteRequestSchema,
  StateAdminDeleteResponseSchema,
  StateAdminGet,
  StateAdminGetRequestSchema,
  StateAdminGetResponseSchema,
  StateAdminList,
  StateAdminListRequestSchema,
  StateAdminListResponseSchema,
} from "@trellis/apis/trellis.state";
import type { Static, TSchema } from "typebox";

import cliParticipantSource from "../../../../../rust/crates/trellis/artifacts/trellis.cli.participant.json" with {
  type: "json",
};

export const ADMIN_USERNAME = "admin";
const adminDescriptors = defineAppContract(() => ({
  id: "test.admin@v1",
  apiId: "test.admin@v1",
  apiVersion: "1.0.0",
  displayName: "Trellis Test Admin",
  description:
    "Automates Trellis test runtime administration through Auth RPCs.",
  uses: [
    AuthDeploymentAuthorityAcceptMigration,
    AuthDeploymentAuthorityAcceptUpdate,
    AuthDeploymentAuthorityGet,
    AuthDeploymentAuthorityList,
    AuthDeploymentAuthorityPlan,
    AuthDeploymentAuthorityReject,
    AuthDeploymentAuthorityPlansList,
    AuthDeploymentAuthorityReconcile,
    AuthDeploymentsCreate,
    AuthDevicesProvision,
    AuthIdentityAuthorityList,
    AuthIdentityAuthorityRevoke,
    AuthConnectionsList,
    AuthCapabilityGroupsPut,
    AuthPortalsList,
    AuthPortalsGrantOverridesPut,
    AuthPortalsGet,
    AuthPortalsGrantOverridesRemove,
    AuthPortalsLoginSettingsUpdate,
    AuthPortalsPut,
    AuthPortalsRoutesPut,
    AuthServiceInstancesProvision,
    AuthSessionsRevoke,
    AuthUserIdentitiesList,
    StateAdminDelete,
    StateAdminGet,
    StateAdminList,
    JobsQuery,
    EventLogQuery,
    HealthQuery,
  ],
}));

const cliParticipant = structuredClone(cliParticipantSource);
const cliParticipantDigest = participantDigest(cliParticipant);

export const adminContract = Object.defineProperty(
  {
    ...adminDescriptors,
    CONTRACT_ID: cliParticipant.id,
    CONTRACT_DIGEST: cliParticipantDigest,
    PARTICIPANT: cliParticipant,
  },
  CONTRACT_RUNTIME,
  {
    value: adminDescriptors[CONTRACT_RUNTIME],
  },
) as
  & Omit<
    typeof adminDescriptors,
    | "CONTRACT_ID"
    | "CONTRACT_DIGEST"
    | "PARTICIPANT"
  >
  & {
    readonly CONTRACT_ID: "trellis-app.cli@v1";
    readonly CONTRACT_DIGEST: string;
    readonly PARTICIPANT: typeof cliParticipant;
  };

export const ADMIN_PARTICIPANT = {
  id: adminContract.CONTRACT_ID,
  artifactDigest: adminContract.CONTRACT_DIGEST,
} as const;

export type AdminClient = CallerRuntime<typeof adminContract>;

function adminMethod<const I extends TSchema, const O extends TSchema>(
  input: I,
  output: O,
  call: (client: AdminClient, input: Static<I>) => Promise<Static<O>>,
) {
  return {
    input,
    output,
    call: (client: AdminClient, value: unknown) =>
      call(client, value as Static<I>),
  } as const;
}

/** @internal Concrete Auth RPCs available to the shared test host. */
export const adminMethods = {
  authCapabilityGroupsPut: adminMethod(
    AuthCapabilityGroupsPutRequestSchema,
    AuthCapabilityGroupsPutResponseSchema,
    (client, input) => client.authCapabilityGroupsPut(input).orThrow(),
  ),
  authConnectionsList: adminMethod(
    AuthConnectionsListRequestSchema,
    AuthConnectionsListResponseSchema,
    (client, input) => client.authConnectionsList(input).orThrow(),
  ),
  authPortalsGrantOverridesRemove: adminMethod(
    AuthPortalsGrantOverridesRemoveRequestSchema,
    AuthPortalsGrantOverridesRemoveResponseSchema,
    (client, input) => client.authPortalsGrantOverridesRemove(input).orThrow(),
  ),
  authPortalsGrantOverridesPut: adminMethod(
    AuthPortalsGrantOverridesPutRequestSchema,
    AuthPortalsGrantOverridesPutResponseSchema,
    (client, input) => client.authPortalsGrantOverridesPut(input).orThrow(),
  ),
  authPortalsGet: adminMethod(
    AuthPortalsGetRequestSchema,
    AuthPortalsGetResponseSchema,
    (client, input) => client.authPortalsGet(input).orThrow(),
  ),
  authPortalsList: adminMethod(
    AuthPortalsListRequestSchema,
    AuthPortalsListResponseSchema,
    (client, input) => client.authPortalsList(input).orThrow(),
  ),
  authPortalsLoginSettingsUpdate: adminMethod(
    AuthPortalsLoginSettingsUpdateRequestSchema,
    AuthPortalsLoginSettingsGetResponseSchema,
    (client, input) => client.authPortalsLoginSettingsUpdate(input).orThrow(),
  ),
  authPortalsPut: adminMethod(
    AuthPortalsPutRequestSchema,
    AuthPortalsPutResponseSchema,
    (client, input) => client.authPortalsPut(input).orThrow(),
  ),
  authPortalsRoutesPut: adminMethod(
    AuthPortalsRoutesPutRequestSchema,
    AuthPortalsRoutesPutResponseSchema,
    (client, input) => client.authPortalsRoutesPut(input).orThrow(),
  ),
  authDevicesProvision: adminMethod(
    AuthDevicesProvisionRequestSchema,
    AuthDevicesProvisionResponseSchema,
    (client, input) => client.authDevicesProvision(input).orThrow(),
  ),
  stateAdminDelete: adminMethod(
    StateAdminDeleteRequestSchema,
    StateAdminDeleteResponseSchema,
    (client, input) => client.stateAdminDelete(input).orThrow(),
  ),
  stateAdminGet: adminMethod(
    StateAdminGetRequestSchema,
    StateAdminGetResponseSchema,
    (client, input) => client.stateAdminGet(input).orThrow(),
  ),
  stateAdminList: adminMethod(
    StateAdminListRequestSchema,
    StateAdminListResponseSchema,
    (client, input) => client.stateAdminList(input).orThrow(),
  ),
  authDeploymentsCreate: adminMethod(
    AuthDeploymentsCreateRequestSchema,
    AuthDeploymentsCreateResponseSchema,
    (client, input) => client.authDeploymentsCreate(input).orThrow(),
  ),
  authDeploymentAuthorityPlan: adminMethod(
    AuthDeploymentAuthorityPlanRequestSchema,
    AuthDeploymentAuthorityPlanResponseSchema,
    (client, input) => client.authDeploymentAuthorityPlan(input).orThrow(),
  ),
  authDeploymentAuthorityAcceptUpdate: adminMethod(
    AuthDeploymentAuthorityAcceptUpdateRequestSchema,
    AuthDeploymentAuthorityAcceptUpdateResponseSchema,
    (client, input) =>
      client.authDeploymentAuthorityAcceptUpdate(input).orThrow(),
  ),
  authDeploymentAuthorityAcceptMigration: adminMethod(
    AuthDeploymentAuthorityAcceptMigrationRequestSchema,
    AuthDeploymentAuthorityAcceptMigrationResponseSchema,
    (client, input) =>
      client.authDeploymentAuthorityAcceptMigration(input).orThrow(),
  ),
  authDeploymentAuthorityList: adminMethod(
    AuthDeploymentAuthorityListRequestSchema,
    AuthDeploymentAuthorityListResponseSchema,
    (client, input) => client.authDeploymentAuthorityList(input).orThrow(),
  ),
  authDeploymentAuthorityReconcile: adminMethod(
    AuthDeploymentAuthorityReconcileRequestSchema,
    AuthDeploymentAuthorityReconcileResponseSchema,
    (client, input) => client.authDeploymentAuthorityReconcile(input).orThrow(),
  ),
  authDeploymentAuthorityGet: adminMethod(
    AuthDeploymentAuthorityGetRequestSchema,
    AuthDeploymentAuthorityGetResponseSchema,
    (client, input) => client.authDeploymentAuthorityGet(input).orThrow(),
  ),
  authServiceInstancesProvision: adminMethod(
    AuthServiceInstancesProvisionRequestSchema,
    AuthServiceInstancesProvisionResponseSchema,
    (client, input) => client.authServiceInstancesProvision(input).orThrow(),
  ),
  authDeploymentAuthorityPlansList: adminMethod(
    AuthDeploymentAuthorityPlansListRequestSchema,
    AuthDeploymentAuthorityPlansListResponseSchema,
    (client, input) => client.authDeploymentAuthorityPlansList(input).orThrow(),
  ),
  authDeploymentAuthorityReject: adminMethod(
    AuthDeploymentAuthorityRejectRequestSchema,
    AuthDeploymentAuthorityRejectResponseSchema,
    (client, input) => client.authDeploymentAuthorityReject(input).orThrow(),
  ),
  authSessionsRevoke: adminMethod(
    AuthSessionsRevokeRequestSchema,
    AuthSessionsRevokeResponseSchema,
    (client, input) => client.authSessionsRevoke(input).orThrow(),
  ),
} as const;

export type AdminRpc = {
  [M in keyof typeof adminMethods]: {
    input: Static<(typeof adminMethods)[M]["input"]>;
    output: Static<(typeof adminMethods)[M]["output"]>;
  };
};

export type AdminRpcInput<M extends TrellisTestAdminRpcMethod> = M extends
  "authDeploymentAuthorityPlan" ? AdminRpc[M]["input"] & {
    referencedApiArtifacts: readonly Record<string, unknown>[];
  }
  : AdminRpc[M]["input"];

export type TrellisTestAdminRpcMethod = keyof typeof adminMethods;
