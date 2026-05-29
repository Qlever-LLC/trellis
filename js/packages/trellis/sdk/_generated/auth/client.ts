// Generated from ./generated/contracts/manifests/trellis.auth@v1.json
import type {
  AcceptedOperation,
  AsyncResult,
  BaseError,
  EventOpts,
  FeedSubscribeOpts,
  FeedSubscription,
  HandlerTrellis,
  MapStateStoreClient,
  MaybeAsync,
  OperationInputBuilder,
  OperationObserverCallbacks,
  OperationRef,
  OperationRefData,
  OperationRuntimeHandle,
  PreparedTrellisEvent,
  ReceiveTransferGrant,
  ReceiveTransferHandle,
  RequestOpts,
  Result,
  RpcHandlerContext,
  SendTransferGrant,
  SendTransferHandle,
  TerminalOperation,
  TransferCapableOperationInputBuilder,
  TrellisConnection,
  UnexpectedError,
  ValidationError,
  ValueStateStoreClient,
} from "@qlever-llc/trellis";
import type { API, Api } from "./api.ts";
import type * as Types from "./types.ts";
import type * as HealthSdk from "@qlever-llc/trellis/sdk/health";

type EventCallback<TMessage> = {
  bivarianceHack(message: TMessage): MaybeAsync<void, BaseError>;
}["bivarianceHack"];

type RpcHandler<TInput, TOutput> = (
  args: { input: TInput; context: RpcHandlerContext; client: HandlerClient },
) => MaybeAsync<TOutput, BaseError>;

export type TrellisAuthState = {};

type AuthDeviceUserAuthoritiesResolveOperationDesc =
  typeof API.owned.operations["Auth.DeviceUserAuthorities.Resolve"];
export type AuthDeviceUserAuthoritiesResolveOperationRef = OperationRef<
  AuthDeviceUserAuthoritiesResolveOperationDesc,
  Types.AuthDeviceUserAuthoritiesResolveProgress,
  Types.AuthDeviceUserAuthoritiesResolveOutput
>;
export type AuthDeviceUserAuthoritiesResolveTerminal = TerminalOperation<
  Types.AuthDeviceUserAuthoritiesResolveProgress,
  Types.AuthDeviceUserAuthoritiesResolveOutput
>;
export interface AuthDeviceUserAuthoritiesResolveOperation {
  resume(ref: OperationRefData): AuthDeviceUserAuthoritiesResolveOperationRef;
  start(
    input: Types.AuthDeviceUserAuthoritiesResolveInput,
    opts?: OperationObserverCallbacks<
      Types.AuthDeviceUserAuthoritiesResolveProgress,
      Types.AuthDeviceUserAuthoritiesResolveOutput
    >,
  ): AsyncResult<AuthDeviceUserAuthoritiesResolveOperationRef, BaseError>;
  input(
    input: Types.AuthDeviceUserAuthoritiesResolveInput,
  ): OperationInputBuilder<
    AuthDeviceUserAuthoritiesResolveOperationDesc,
    Types.AuthDeviceUserAuthoritiesResolveProgress,
    Types.AuthDeviceUserAuthoritiesResolveOutput
  >;
}

export interface TrellisAuthClient {
  readonly name: string;
  readonly timeout: number;
  readonly stream: string;
  readonly api: Api;
  readonly state: TrellisAuthState;
  readonly connection: TrellisConnection;
  transfer(grant: SendTransferGrant): SendTransferHandle;
  transfer(grant: ReceiveTransferGrant): ReceiveTransferHandle;
  readonly rpc: {
    readonly auth: {
      capabilitiesList(
        input: Types.AuthCapabilitiesListInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthCapabilitiesListOutput, BaseError>;
      capabilityGroupsDelete(
        input: Types.AuthCapabilityGroupsDeleteInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthCapabilityGroupsDeleteOutput, BaseError>;
      capabilityGroupsGet(
        input: Types.AuthCapabilityGroupsGetInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthCapabilityGroupsGetOutput, BaseError>;
      capabilityGroupsList(
        input: Types.AuthCapabilityGroupsListInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthCapabilityGroupsListOutput, BaseError>;
      capabilityGroupsPut(
        input: Types.AuthCapabilityGroupsPutInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthCapabilityGroupsPutOutput, BaseError>;
      catalogIssuesResolve(
        input: Types.AuthCatalogIssuesResolveInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthCatalogIssuesResolveOutput, BaseError>;
      connectionsKick(
        input: Types.AuthConnectionsKickInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthConnectionsKickOutput, BaseError>;
      connectionsList(
        input: Types.AuthConnectionsListInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthConnectionsListOutput, BaseError>;
      deploymentAuthorityAcceptMigration(
        input: Types.AuthDeploymentAuthorityAcceptMigrationInput,
        opts?: RequestOpts,
      ): AsyncResult<
        Types.AuthDeploymentAuthorityAcceptMigrationOutput,
        BaseError
      >;
      deploymentAuthorityAcceptUpdate(
        input: Types.AuthDeploymentAuthorityAcceptUpdateInput,
        opts?: RequestOpts,
      ): AsyncResult<
        Types.AuthDeploymentAuthorityAcceptUpdateOutput,
        BaseError
      >;
      deploymentAuthorityGet(
        input: Types.AuthDeploymentAuthorityGetInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthDeploymentAuthorityGetOutput, BaseError>;
      deploymentAuthorityGrantOverridesList(
        input: Types.AuthDeploymentAuthorityGrantOverridesListInput,
        opts?: RequestOpts,
      ): AsyncResult<
        Types.AuthDeploymentAuthorityGrantOverridesListOutput,
        BaseError
      >;
      deploymentAuthorityGrantOverridesPut(
        input: Types.AuthDeploymentAuthorityGrantOverridesPutInput,
        opts?: RequestOpts,
      ): AsyncResult<
        Types.AuthDeploymentAuthorityGrantOverridesPutOutput,
        BaseError
      >;
      deploymentAuthorityGrantOverridesRemove(
        input: Types.AuthDeploymentAuthorityGrantOverridesRemoveInput,
        opts?: RequestOpts,
      ): AsyncResult<
        Types.AuthDeploymentAuthorityGrantOverridesRemoveOutput,
        BaseError
      >;
      deploymentAuthorityList(
        input: Types.AuthDeploymentAuthorityListInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthDeploymentAuthorityListOutput, BaseError>;
      deploymentAuthorityPlan(
        input: Types.AuthDeploymentAuthorityPlanInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthDeploymentAuthorityPlanOutput, BaseError>;
      deploymentAuthorityPlansGet(
        input: Types.AuthDeploymentAuthorityPlansGetInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthDeploymentAuthorityPlansGetOutput, BaseError>;
      deploymentAuthorityPlansList(
        input: Types.AuthDeploymentAuthorityPlansListInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthDeploymentAuthorityPlansListOutput, BaseError>;
      deploymentAuthorityReconcile(
        input: Types.AuthDeploymentAuthorityReconcileInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthDeploymentAuthorityReconcileOutput, BaseError>;
      deploymentAuthorityReject(
        input: Types.AuthDeploymentAuthorityRejectInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthDeploymentAuthorityRejectOutput, BaseError>;
      deploymentsCreate(
        input: Types.AuthDeploymentsCreateInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthDeploymentsCreateOutput, BaseError>;
      deploymentsDisable(
        input: Types.AuthDeploymentsDisableInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthDeploymentsDisableOutput, BaseError>;
      deploymentsEnable(
        input: Types.AuthDeploymentsEnableInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthDeploymentsEnableOutput, BaseError>;
      deploymentsList(
        input: Types.AuthDeploymentsListInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthDeploymentsListOutput, BaseError>;
      deploymentsRemove(
        input: Types.AuthDeploymentsRemoveInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthDeploymentsRemoveOutput, BaseError>;
      deviceUserAuthoritiesList(
        input: Types.AuthDeviceUserAuthoritiesListInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthDeviceUserAuthoritiesListOutput, BaseError>;
      deviceUserAuthoritiesReviewsDecide(
        input: Types.AuthDeviceUserAuthoritiesReviewsDecideInput,
        opts?: RequestOpts,
      ): AsyncResult<
        Types.AuthDeviceUserAuthoritiesReviewsDecideOutput,
        BaseError
      >;
      deviceUserAuthoritiesReviewsList(
        input: Types.AuthDeviceUserAuthoritiesReviewsListInput,
        opts?: RequestOpts,
      ): AsyncResult<
        Types.AuthDeviceUserAuthoritiesReviewsListOutput,
        BaseError
      >;
      deviceUserAuthoritiesRevoke(
        input: Types.AuthDeviceUserAuthoritiesRevokeInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthDeviceUserAuthoritiesRevokeOutput, BaseError>;
      devicesConnectInfoGet(
        input: Types.AuthDevicesConnectInfoGetInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthDevicesConnectInfoGetOutput, BaseError>;
      devicesDisable(
        input: Types.AuthDevicesDisableInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthDevicesDisableOutput, BaseError>;
      devicesEnable(
        input: Types.AuthDevicesEnableInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthDevicesEnableOutput, BaseError>;
      devicesList(
        input: Types.AuthDevicesListInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthDevicesListOutput, BaseError>;
      devicesProvision(
        input: Types.AuthDevicesProvisionInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthDevicesProvisionOutput, BaseError>;
      devicesRemove(
        input: Types.AuthDevicesRemoveInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthDevicesRemoveOutput, BaseError>;
      health(
        input: Types.AuthHealthInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthHealthOutput, BaseError>;
      identitiesList(
        input: Types.AuthIdentitiesListInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthIdentitiesListOutput, BaseError>;
      identityGrantsList(
        input: Types.AuthIdentityGrantsListInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthIdentityGrantsListOutput, BaseError>;
      identityGrantsRevoke(
        input: Types.AuthIdentityGrantsRevokeInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthIdentityGrantsRevokeOutput, BaseError>;
      portalsGet(
        input: Types.AuthPortalsGetInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthPortalsGetOutput, BaseError>;
      portalsList(
        input: Types.AuthPortalsListInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthPortalsListOutput, BaseError>;
      portalsLoginSettingsGet(
        input: Types.AuthPortalsLoginSettingsGetInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthPortalsLoginSettingsGetOutput, BaseError>;
      portalsLoginSettingsUpdate(
        input: Types.AuthPortalsLoginSettingsUpdateInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthPortalsLoginSettingsUpdateOutput, BaseError>;
      portalsPut(
        input: Types.AuthPortalsPutInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthPortalsPutOutput, BaseError>;
      portalsRemove(
        input: Types.AuthPortalsRemoveInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthPortalsRemoveOutput, BaseError>;
      portalsRoutesPut(
        input: Types.AuthPortalsRoutesPutInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthPortalsRoutesPutOutput, BaseError>;
      portalsRoutesRemove(
        input: Types.AuthPortalsRoutesRemoveInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthPortalsRoutesRemoveOutput, BaseError>;
      requestsValidate(
        input: Types.AuthRequestsValidateInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthRequestsValidateOutput, BaseError>;
      serviceInstancesDisable(
        input: Types.AuthServiceInstancesDisableInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthServiceInstancesDisableOutput, BaseError>;
      serviceInstancesEnable(
        input: Types.AuthServiceInstancesEnableInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthServiceInstancesEnableOutput, BaseError>;
      serviceInstancesList(
        input: Types.AuthServiceInstancesListInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthServiceInstancesListOutput, BaseError>;
      serviceInstancesProvision(
        input: Types.AuthServiceInstancesProvisionInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthServiceInstancesProvisionOutput, BaseError>;
      serviceInstancesRemove(
        input: Types.AuthServiceInstancesRemoveInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthServiceInstancesRemoveOutput, BaseError>;
      sessionsList(
        input: Types.AuthSessionsListInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthSessionsListOutput, BaseError>;
      sessionsLogout(
        input: Types.AuthSessionsLogoutInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthSessionsLogoutOutput, BaseError>;
      sessionsMe(
        input: Types.AuthSessionsMeInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthSessionsMeOutput, BaseError>;
      sessionsRevoke(
        input: Types.AuthSessionsRevokeInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthSessionsRevokeOutput, BaseError>;
      userIdentitiesList(
        input: Types.AuthUserIdentitiesListInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthUserIdentitiesListOutput, BaseError>;
      userIdentitiesUnlink(
        input: Types.AuthUserIdentitiesUnlinkInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthUserIdentitiesUnlinkOutput, BaseError>;
      usersCreate(
        input: Types.AuthUsersCreateInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthUsersCreateOutput, BaseError>;
      usersGet(
        input: Types.AuthUsersGetInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthUsersGetOutput, BaseError>;
      usersIdentityLinkCreate(
        input: Types.AuthUsersIdentityLinkCreateInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthUsersIdentityLinkCreateOutput, BaseError>;
      usersList(
        input: Types.AuthUsersListInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthUsersListOutput, BaseError>;
      usersPasswordChange(
        input: Types.AuthUsersPasswordChangeInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthUsersPasswordChangeOutput, BaseError>;
      usersPasswordResetCreate(
        input: Types.AuthUsersPasswordResetCreateInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthUsersPasswordResetCreateOutput, BaseError>;
      usersUpdate(
        input: Types.AuthUsersUpdateInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.AuthUsersUpdateOutput, BaseError>;
    };
  };
  readonly event: {
    readonly auth: {
      connectionsClosed: {
        publish(
          event: Omit<Types.AuthConnectionsClosedEvent, "header">,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: Omit<Types.AuthConnectionsClosedEvent, "header">,
        ): Result<
          PreparedTrellisEvent<
            Omit<Types.AuthConnectionsClosedEvent, "header">
          >,
          ValidationError | UnexpectedError
        >;
        listen(
          handler: EventCallback<Types.AuthConnectionsClosedEvent>,
          subjectData?: Record<string, unknown>,
          opts?: EventOpts,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
      };
      connectionsKicked: {
        publish(
          event: Omit<Types.AuthConnectionsKickedEvent, "header">,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: Omit<Types.AuthConnectionsKickedEvent, "header">,
        ): Result<
          PreparedTrellisEvent<
            Omit<Types.AuthConnectionsKickedEvent, "header">
          >,
          ValidationError | UnexpectedError
        >;
        listen(
          handler: EventCallback<Types.AuthConnectionsKickedEvent>,
          subjectData?: Record<string, unknown>,
          opts?: EventOpts,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
      };
      connectionsOpened: {
        publish(
          event: Omit<Types.AuthConnectionsOpenedEvent, "header">,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: Omit<Types.AuthConnectionsOpenedEvent, "header">,
        ): Result<
          PreparedTrellisEvent<
            Omit<Types.AuthConnectionsOpenedEvent, "header">
          >,
          ValidationError | UnexpectedError
        >;
        listen(
          handler: EventCallback<Types.AuthConnectionsOpenedEvent>,
          subjectData?: Record<string, unknown>,
          opts?: EventOpts,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
      };
      deviceUserAuthoritiesApproved: {
        publish(
          event: Omit<Types.AuthDeviceUserAuthoritiesApprovedEvent, "header">,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: Omit<Types.AuthDeviceUserAuthoritiesApprovedEvent, "header">,
        ): Result<
          PreparedTrellisEvent<
            Omit<Types.AuthDeviceUserAuthoritiesApprovedEvent, "header">
          >,
          ValidationError | UnexpectedError
        >;
        listen(
          handler: EventCallback<Types.AuthDeviceUserAuthoritiesApprovedEvent>,
          subjectData?: Record<string, unknown>,
          opts?: EventOpts,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
      };
      deviceUserAuthoritiesRequested: {
        publish(
          event: Omit<Types.AuthDeviceUserAuthoritiesRequestedEvent, "header">,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: Omit<Types.AuthDeviceUserAuthoritiesRequestedEvent, "header">,
        ): Result<
          PreparedTrellisEvent<
            Omit<Types.AuthDeviceUserAuthoritiesRequestedEvent, "header">
          >,
          ValidationError | UnexpectedError
        >;
        listen(
          handler: EventCallback<Types.AuthDeviceUserAuthoritiesRequestedEvent>,
          subjectData?: Record<string, unknown>,
          opts?: EventOpts,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
      };
      deviceUserAuthoritiesResolved: {
        publish(
          event: Omit<Types.AuthDeviceUserAuthoritiesResolvedEvent, "header">,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: Omit<Types.AuthDeviceUserAuthoritiesResolvedEvent, "header">,
        ): Result<
          PreparedTrellisEvent<
            Omit<Types.AuthDeviceUserAuthoritiesResolvedEvent, "header">
          >,
          ValidationError | UnexpectedError
        >;
        listen(
          handler: EventCallback<Types.AuthDeviceUserAuthoritiesResolvedEvent>,
          subjectData?: Record<string, unknown>,
          opts?: EventOpts,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
      };
      deviceUserAuthoritiesReviewRequested: {
        publish(
          event: Omit<
            Types.AuthDeviceUserAuthoritiesReviewRequestedEvent,
            "header"
          >,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: Omit<
            Types.AuthDeviceUserAuthoritiesReviewRequestedEvent,
            "header"
          >,
        ): Result<
          PreparedTrellisEvent<
            Omit<Types.AuthDeviceUserAuthoritiesReviewRequestedEvent, "header">
          >,
          ValidationError | UnexpectedError
        >;
        listen(
          handler: EventCallback<
            Types.AuthDeviceUserAuthoritiesReviewRequestedEvent
          >,
          subjectData?: Record<string, unknown>,
          opts?: EventOpts,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
      };
      sessionsRevoked: {
        publish(
          event: Omit<Types.AuthSessionsRevokedEvent, "header">,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: Omit<Types.AuthSessionsRevokedEvent, "header">,
        ): Result<
          PreparedTrellisEvent<Omit<Types.AuthSessionsRevokedEvent, "header">>,
          ValidationError | UnexpectedError
        >;
        listen(
          handler: EventCallback<Types.AuthSessionsRevokedEvent>,
          subjectData?: Record<string, unknown>,
          opts?: EventOpts,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
      };
    };
    readonly health: {
      heartbeat: {
        publish(
          event: Omit<HealthSdk.HealthHeartbeatEvent, "header">,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: Omit<HealthSdk.HealthHeartbeatEvent, "header">,
        ): Result<
          PreparedTrellisEvent<Omit<HealthSdk.HealthHeartbeatEvent, "header">>,
          ValidationError | UnexpectedError
        >;
        listen(
          handler: EventCallback<HealthSdk.HealthHeartbeatEvent>,
          subjectData?: Record<string, unknown>,
          opts?: EventOpts,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
      };
    };
  };
  readonly feed: {};
  readonly operation: {
    readonly auth: {
      deviceUserAuthoritiesResolve: AuthDeviceUserAuthoritiesResolveOperation;
    };
  };
  wait(): AsyncResult<void, BaseError>;
}

export interface Service extends Client {
  readonly handle: ServiceHandle;
}

export interface ServiceHandle {
  readonly rpc: {
    readonly auth: {
      capabilitiesList(
        handler: RpcHandler<
          Types.AuthCapabilitiesListInput,
          Types.AuthCapabilitiesListOutput
        >,
      ): Promise<void>;
      capabilityGroupsDelete(
        handler: RpcHandler<
          Types.AuthCapabilityGroupsDeleteInput,
          Types.AuthCapabilityGroupsDeleteOutput
        >,
      ): Promise<void>;
      capabilityGroupsGet(
        handler: RpcHandler<
          Types.AuthCapabilityGroupsGetInput,
          Types.AuthCapabilityGroupsGetOutput
        >,
      ): Promise<void>;
      capabilityGroupsList(
        handler: RpcHandler<
          Types.AuthCapabilityGroupsListInput,
          Types.AuthCapabilityGroupsListOutput
        >,
      ): Promise<void>;
      capabilityGroupsPut(
        handler: RpcHandler<
          Types.AuthCapabilityGroupsPutInput,
          Types.AuthCapabilityGroupsPutOutput
        >,
      ): Promise<void>;
      catalogIssuesResolve(
        handler: RpcHandler<
          Types.AuthCatalogIssuesResolveInput,
          Types.AuthCatalogIssuesResolveOutput
        >,
      ): Promise<void>;
      connectionsKick(
        handler: RpcHandler<
          Types.AuthConnectionsKickInput,
          Types.AuthConnectionsKickOutput
        >,
      ): Promise<void>;
      connectionsList(
        handler: RpcHandler<
          Types.AuthConnectionsListInput,
          Types.AuthConnectionsListOutput
        >,
      ): Promise<void>;
      deploymentAuthorityAcceptMigration(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityAcceptMigrationInput,
          Types.AuthDeploymentAuthorityAcceptMigrationOutput
        >,
      ): Promise<void>;
      deploymentAuthorityAcceptUpdate(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityAcceptUpdateInput,
          Types.AuthDeploymentAuthorityAcceptUpdateOutput
        >,
      ): Promise<void>;
      deploymentAuthorityGet(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityGetInput,
          Types.AuthDeploymentAuthorityGetOutput
        >,
      ): Promise<void>;
      deploymentAuthorityGrantOverridesList(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityGrantOverridesListInput,
          Types.AuthDeploymentAuthorityGrantOverridesListOutput
        >,
      ): Promise<void>;
      deploymentAuthorityGrantOverridesPut(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityGrantOverridesPutInput,
          Types.AuthDeploymentAuthorityGrantOverridesPutOutput
        >,
      ): Promise<void>;
      deploymentAuthorityGrantOverridesRemove(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityGrantOverridesRemoveInput,
          Types.AuthDeploymentAuthorityGrantOverridesRemoveOutput
        >,
      ): Promise<void>;
      deploymentAuthorityList(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityListInput,
          Types.AuthDeploymentAuthorityListOutput
        >,
      ): Promise<void>;
      deploymentAuthorityPlan(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityPlanInput,
          Types.AuthDeploymentAuthorityPlanOutput
        >,
      ): Promise<void>;
      deploymentAuthorityPlansGet(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityPlansGetInput,
          Types.AuthDeploymentAuthorityPlansGetOutput
        >,
      ): Promise<void>;
      deploymentAuthorityPlansList(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityPlansListInput,
          Types.AuthDeploymentAuthorityPlansListOutput
        >,
      ): Promise<void>;
      deploymentAuthorityReconcile(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityReconcileInput,
          Types.AuthDeploymentAuthorityReconcileOutput
        >,
      ): Promise<void>;
      deploymentAuthorityReject(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityRejectInput,
          Types.AuthDeploymentAuthorityRejectOutput
        >,
      ): Promise<void>;
      deploymentsCreate(
        handler: RpcHandler<
          Types.AuthDeploymentsCreateInput,
          Types.AuthDeploymentsCreateOutput
        >,
      ): Promise<void>;
      deploymentsDisable(
        handler: RpcHandler<
          Types.AuthDeploymentsDisableInput,
          Types.AuthDeploymentsDisableOutput
        >,
      ): Promise<void>;
      deploymentsEnable(
        handler: RpcHandler<
          Types.AuthDeploymentsEnableInput,
          Types.AuthDeploymentsEnableOutput
        >,
      ): Promise<void>;
      deploymentsList(
        handler: RpcHandler<
          Types.AuthDeploymentsListInput,
          Types.AuthDeploymentsListOutput
        >,
      ): Promise<void>;
      deploymentsRemove(
        handler: RpcHandler<
          Types.AuthDeploymentsRemoveInput,
          Types.AuthDeploymentsRemoveOutput
        >,
      ): Promise<void>;
      deviceUserAuthoritiesList(
        handler: RpcHandler<
          Types.AuthDeviceUserAuthoritiesListInput,
          Types.AuthDeviceUserAuthoritiesListOutput
        >,
      ): Promise<void>;
      deviceUserAuthoritiesReviewsDecide(
        handler: RpcHandler<
          Types.AuthDeviceUserAuthoritiesReviewsDecideInput,
          Types.AuthDeviceUserAuthoritiesReviewsDecideOutput
        >,
      ): Promise<void>;
      deviceUserAuthoritiesReviewsList(
        handler: RpcHandler<
          Types.AuthDeviceUserAuthoritiesReviewsListInput,
          Types.AuthDeviceUserAuthoritiesReviewsListOutput
        >,
      ): Promise<void>;
      deviceUserAuthoritiesRevoke(
        handler: RpcHandler<
          Types.AuthDeviceUserAuthoritiesRevokeInput,
          Types.AuthDeviceUserAuthoritiesRevokeOutput
        >,
      ): Promise<void>;
      devicesConnectInfoGet(
        handler: RpcHandler<
          Types.AuthDevicesConnectInfoGetInput,
          Types.AuthDevicesConnectInfoGetOutput
        >,
      ): Promise<void>;
      devicesDisable(
        handler: RpcHandler<
          Types.AuthDevicesDisableInput,
          Types.AuthDevicesDisableOutput
        >,
      ): Promise<void>;
      devicesEnable(
        handler: RpcHandler<
          Types.AuthDevicesEnableInput,
          Types.AuthDevicesEnableOutput
        >,
      ): Promise<void>;
      devicesList(
        handler: RpcHandler<
          Types.AuthDevicesListInput,
          Types.AuthDevicesListOutput
        >,
      ): Promise<void>;
      devicesProvision(
        handler: RpcHandler<
          Types.AuthDevicesProvisionInput,
          Types.AuthDevicesProvisionOutput
        >,
      ): Promise<void>;
      devicesRemove(
        handler: RpcHandler<
          Types.AuthDevicesRemoveInput,
          Types.AuthDevicesRemoveOutput
        >,
      ): Promise<void>;
      health(
        handler: RpcHandler<Types.AuthHealthInput, Types.AuthHealthOutput>,
      ): Promise<void>;
      identitiesList(
        handler: RpcHandler<
          Types.AuthIdentitiesListInput,
          Types.AuthIdentitiesListOutput
        >,
      ): Promise<void>;
      identityGrantsList(
        handler: RpcHandler<
          Types.AuthIdentityGrantsListInput,
          Types.AuthIdentityGrantsListOutput
        >,
      ): Promise<void>;
      identityGrantsRevoke(
        handler: RpcHandler<
          Types.AuthIdentityGrantsRevokeInput,
          Types.AuthIdentityGrantsRevokeOutput
        >,
      ): Promise<void>;
      portalsGet(
        handler: RpcHandler<
          Types.AuthPortalsGetInput,
          Types.AuthPortalsGetOutput
        >,
      ): Promise<void>;
      portalsList(
        handler: RpcHandler<
          Types.AuthPortalsListInput,
          Types.AuthPortalsListOutput
        >,
      ): Promise<void>;
      portalsLoginSettingsGet(
        handler: RpcHandler<
          Types.AuthPortalsLoginSettingsGetInput,
          Types.AuthPortalsLoginSettingsGetOutput
        >,
      ): Promise<void>;
      portalsLoginSettingsUpdate(
        handler: RpcHandler<
          Types.AuthPortalsLoginSettingsUpdateInput,
          Types.AuthPortalsLoginSettingsUpdateOutput
        >,
      ): Promise<void>;
      portalsPut(
        handler: RpcHandler<
          Types.AuthPortalsPutInput,
          Types.AuthPortalsPutOutput
        >,
      ): Promise<void>;
      portalsRemove(
        handler: RpcHandler<
          Types.AuthPortalsRemoveInput,
          Types.AuthPortalsRemoveOutput
        >,
      ): Promise<void>;
      portalsRoutesPut(
        handler: RpcHandler<
          Types.AuthPortalsRoutesPutInput,
          Types.AuthPortalsRoutesPutOutput
        >,
      ): Promise<void>;
      portalsRoutesRemove(
        handler: RpcHandler<
          Types.AuthPortalsRoutesRemoveInput,
          Types.AuthPortalsRoutesRemoveOutput
        >,
      ): Promise<void>;
      requestsValidate(
        handler: RpcHandler<
          Types.AuthRequestsValidateInput,
          Types.AuthRequestsValidateOutput
        >,
      ): Promise<void>;
      serviceInstancesDisable(
        handler: RpcHandler<
          Types.AuthServiceInstancesDisableInput,
          Types.AuthServiceInstancesDisableOutput
        >,
      ): Promise<void>;
      serviceInstancesEnable(
        handler: RpcHandler<
          Types.AuthServiceInstancesEnableInput,
          Types.AuthServiceInstancesEnableOutput
        >,
      ): Promise<void>;
      serviceInstancesList(
        handler: RpcHandler<
          Types.AuthServiceInstancesListInput,
          Types.AuthServiceInstancesListOutput
        >,
      ): Promise<void>;
      serviceInstancesProvision(
        handler: RpcHandler<
          Types.AuthServiceInstancesProvisionInput,
          Types.AuthServiceInstancesProvisionOutput
        >,
      ): Promise<void>;
      serviceInstancesRemove(
        handler: RpcHandler<
          Types.AuthServiceInstancesRemoveInput,
          Types.AuthServiceInstancesRemoveOutput
        >,
      ): Promise<void>;
      sessionsList(
        handler: RpcHandler<
          Types.AuthSessionsListInput,
          Types.AuthSessionsListOutput
        >,
      ): Promise<void>;
      sessionsLogout(
        handler: RpcHandler<
          Types.AuthSessionsLogoutInput,
          Types.AuthSessionsLogoutOutput
        >,
      ): Promise<void>;
      sessionsMe(
        handler: RpcHandler<
          Types.AuthSessionsMeInput,
          Types.AuthSessionsMeOutput
        >,
      ): Promise<void>;
      sessionsRevoke(
        handler: RpcHandler<
          Types.AuthSessionsRevokeInput,
          Types.AuthSessionsRevokeOutput
        >,
      ): Promise<void>;
      userIdentitiesList(
        handler: RpcHandler<
          Types.AuthUserIdentitiesListInput,
          Types.AuthUserIdentitiesListOutput
        >,
      ): Promise<void>;
      userIdentitiesUnlink(
        handler: RpcHandler<
          Types.AuthUserIdentitiesUnlinkInput,
          Types.AuthUserIdentitiesUnlinkOutput
        >,
      ): Promise<void>;
      usersCreate(
        handler: RpcHandler<
          Types.AuthUsersCreateInput,
          Types.AuthUsersCreateOutput
        >,
      ): Promise<void>;
      usersGet(
        handler: RpcHandler<Types.AuthUsersGetInput, Types.AuthUsersGetOutput>,
      ): Promise<void>;
      usersIdentityLinkCreate(
        handler: RpcHandler<
          Types.AuthUsersIdentityLinkCreateInput,
          Types.AuthUsersIdentityLinkCreateOutput
        >,
      ): Promise<void>;
      usersList(
        handler: RpcHandler<
          Types.AuthUsersListInput,
          Types.AuthUsersListOutput
        >,
      ): Promise<void>;
      usersPasswordChange(
        handler: RpcHandler<
          Types.AuthUsersPasswordChangeInput,
          Types.AuthUsersPasswordChangeOutput
        >,
      ): Promise<void>;
      usersPasswordResetCreate(
        handler: RpcHandler<
          Types.AuthUsersPasswordResetCreateInput,
          Types.AuthUsersPasswordResetCreateOutput
        >,
      ): Promise<void>;
      usersUpdate(
        handler: RpcHandler<
          Types.AuthUsersUpdateInput,
          Types.AuthUsersUpdateOutput
        >,
      ): Promise<void>;
    };
  };
  readonly feed: {};
  readonly operation: {
    readonly auth: {
      deviceUserAuthoritiesResolve:
        & ((
          handler: (
            context: {
              input: Types.AuthDeviceUserAuthoritiesResolveInput;
              client: HandlerClient;
            },
          ) => unknown | Promise<unknown>,
        ) => Promise<void>)
        & {
          accept(
            args: { sessionKey: string },
          ): AsyncResult<
            AcceptedOperation<
              Types.AuthDeviceUserAuthoritiesResolveProgress,
              Types.AuthDeviceUserAuthoritiesResolveOutput
            >,
            UnexpectedError
          >;
          control(
            operationId: string,
          ): AsyncResult<
            OperationRuntimeHandle<
              Types.AuthDeviceUserAuthoritiesResolveProgress,
              Types.AuthDeviceUserAuthoritiesResolveOutput
            >,
            BaseError
          >;
        };
    };
  };
}

export type HandlerClient = HandlerTrellis<Api>;
export type Client = TrellisAuthClient;
