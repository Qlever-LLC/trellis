// Generated from ./generated/contracts/manifests/trellis.auth@v1.json
import type {
  AcceptedOperation,
  AsyncResult,
  BaseError,
  EventListenerContext,
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
  SendTransferGrant,
  SendTransferHandle,
  TerminalOperation,
  TransferCapableOperationInputBuilder,
  TrellisConnection,
  UnexpectedError,
  ValidationError,
  ValueStateStoreClient,
} from "../../../index.ts";
import type { API, Api } from "./api.ts";
import type * as Types from "./types.ts";
import type {
  OperationHandler as ServiceOperationHandler,
  RpcHandler as ServiceRpcHandler,
  ServiceEventHandler as ServiceOwnedEventHandler,
} from "@qlever-llc/trellis/service";
import type { sdk } from "./contract.ts";
import type * as HealthSdk from "../health/mod.ts";

type WithDeps<TDeps> = [TDeps] extends [undefined] ? {} : { deps: TDeps };

type EventCallback<TMessage> = {
  bivarianceHack(
    message: TMessage,
    context: EventListenerContext,
  ): MaybeAsync<void, BaseError>;
}["bivarianceHack"];

type DependencyServiceEventHandler<TEvent, TDeps = undefined> = (
  args:
    & { event: TEvent; context: EventListenerContext; client: HandlerClient }
    & WithDeps<TDeps>,
) => MaybeAsync<void, BaseError>;

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
          event: Types.AuthConnectionsClosedEvent,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: Types.AuthConnectionsClosedEvent,
        ): Result<
          PreparedTrellisEvent<Types.AuthConnectionsClosedEvent>,
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
          event: Types.AuthConnectionsKickedEvent,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: Types.AuthConnectionsKickedEvent,
        ): Result<
          PreparedTrellisEvent<Types.AuthConnectionsKickedEvent>,
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
          event: Types.AuthConnectionsOpenedEvent,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: Types.AuthConnectionsOpenedEvent,
        ): Result<
          PreparedTrellisEvent<Types.AuthConnectionsOpenedEvent>,
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
          event: Types.AuthDeviceUserAuthoritiesApprovedEvent,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: Types.AuthDeviceUserAuthoritiesApprovedEvent,
        ): Result<
          PreparedTrellisEvent<Types.AuthDeviceUserAuthoritiesApprovedEvent>,
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
          event: Types.AuthDeviceUserAuthoritiesRequestedEvent,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: Types.AuthDeviceUserAuthoritiesRequestedEvent,
        ): Result<
          PreparedTrellisEvent<Types.AuthDeviceUserAuthoritiesRequestedEvent>,
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
          event: Types.AuthDeviceUserAuthoritiesResolvedEvent,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: Types.AuthDeviceUserAuthoritiesResolvedEvent,
        ): Result<
          PreparedTrellisEvent<Types.AuthDeviceUserAuthoritiesResolvedEvent>,
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
          event: Types.AuthDeviceUserAuthoritiesReviewRequestedEvent,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: Types.AuthDeviceUserAuthoritiesReviewRequestedEvent,
        ): Result<
          PreparedTrellisEvent<
            Types.AuthDeviceUserAuthoritiesReviewRequestedEvent
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
          event: Types.AuthSessionsRevokedEvent,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: Types.AuthSessionsRevokedEvent,
        ): Result<
          PreparedTrellisEvent<Types.AuthSessionsRevokedEvent>,
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
          event: HealthSdk.HealthHeartbeatEvent,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: HealthSdk.HealthHeartbeatEvent,
        ): Result<
          PreparedTrellisEvent<HealthSdk.HealthHeartbeatEvent>,
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

export interface Service extends TrellisAuthClient {
  readonly handle: ServiceHandle;
  with<TDeps>(deps: TDeps): ServiceWithDeps<TDeps>;
}

export type ServiceWithDeps<TDeps> = Omit<TrellisAuthClient, "event"> & {
  readonly event: ServiceEventSurface<TDeps>;
  readonly handle: ServiceHandle<TDeps>;
  with<TNextDeps>(deps: TNextDeps): ServiceWithDeps<TNextDeps>;
};

export interface ServiceEventSurface<TDeps> {
  readonly auth: {
    connectionsClosed: {
      publish(
        event: Types.AuthConnectionsClosedEvent,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
      prepare(
        event: Types.AuthConnectionsClosedEvent,
      ): Result<
        PreparedTrellisEvent<Types.AuthConnectionsClosedEvent>,
        ValidationError | UnexpectedError
      >;
      listen(
        handler: ServiceOwnedEventHandler<
          typeof sdk,
          "Auth.Connections.Closed",
          TDeps
        >,
        subjectData?: Record<string, unknown>,
        opts?: EventOpts,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
    };
    connectionsKicked: {
      publish(
        event: Types.AuthConnectionsKickedEvent,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
      prepare(
        event: Types.AuthConnectionsKickedEvent,
      ): Result<
        PreparedTrellisEvent<Types.AuthConnectionsKickedEvent>,
        ValidationError | UnexpectedError
      >;
      listen(
        handler: ServiceOwnedEventHandler<
          typeof sdk,
          "Auth.Connections.Kicked",
          TDeps
        >,
        subjectData?: Record<string, unknown>,
        opts?: EventOpts,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
    };
    connectionsOpened: {
      publish(
        event: Types.AuthConnectionsOpenedEvent,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
      prepare(
        event: Types.AuthConnectionsOpenedEvent,
      ): Result<
        PreparedTrellisEvent<Types.AuthConnectionsOpenedEvent>,
        ValidationError | UnexpectedError
      >;
      listen(
        handler: ServiceOwnedEventHandler<
          typeof sdk,
          "Auth.Connections.Opened",
          TDeps
        >,
        subjectData?: Record<string, unknown>,
        opts?: EventOpts,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
    };
    deviceUserAuthoritiesApproved: {
      publish(
        event: Types.AuthDeviceUserAuthoritiesApprovedEvent,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
      prepare(
        event: Types.AuthDeviceUserAuthoritiesApprovedEvent,
      ): Result<
        PreparedTrellisEvent<Types.AuthDeviceUserAuthoritiesApprovedEvent>,
        ValidationError | UnexpectedError
      >;
      listen(
        handler: ServiceOwnedEventHandler<
          typeof sdk,
          "Auth.DeviceUserAuthorities.Approved",
          TDeps
        >,
        subjectData?: Record<string, unknown>,
        opts?: EventOpts,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
    };
    deviceUserAuthoritiesRequested: {
      publish(
        event: Types.AuthDeviceUserAuthoritiesRequestedEvent,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
      prepare(
        event: Types.AuthDeviceUserAuthoritiesRequestedEvent,
      ): Result<
        PreparedTrellisEvent<Types.AuthDeviceUserAuthoritiesRequestedEvent>,
        ValidationError | UnexpectedError
      >;
      listen(
        handler: ServiceOwnedEventHandler<
          typeof sdk,
          "Auth.DeviceUserAuthorities.Requested",
          TDeps
        >,
        subjectData?: Record<string, unknown>,
        opts?: EventOpts,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
    };
    deviceUserAuthoritiesResolved: {
      publish(
        event: Types.AuthDeviceUserAuthoritiesResolvedEvent,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
      prepare(
        event: Types.AuthDeviceUserAuthoritiesResolvedEvent,
      ): Result<
        PreparedTrellisEvent<Types.AuthDeviceUserAuthoritiesResolvedEvent>,
        ValidationError | UnexpectedError
      >;
      listen(
        handler: ServiceOwnedEventHandler<
          typeof sdk,
          "Auth.DeviceUserAuthorities.Resolved",
          TDeps
        >,
        subjectData?: Record<string, unknown>,
        opts?: EventOpts,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
    };
    deviceUserAuthoritiesReviewRequested: {
      publish(
        event: Types.AuthDeviceUserAuthoritiesReviewRequestedEvent,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
      prepare(
        event: Types.AuthDeviceUserAuthoritiesReviewRequestedEvent,
      ): Result<
        PreparedTrellisEvent<
          Types.AuthDeviceUserAuthoritiesReviewRequestedEvent
        >,
        ValidationError | UnexpectedError
      >;
      listen(
        handler: ServiceOwnedEventHandler<
          typeof sdk,
          "Auth.DeviceUserAuthorities.ReviewRequested",
          TDeps
        >,
        subjectData?: Record<string, unknown>,
        opts?: EventOpts,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
    };
    sessionsRevoked: {
      publish(
        event: Types.AuthSessionsRevokedEvent,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
      prepare(
        event: Types.AuthSessionsRevokedEvent,
      ): Result<
        PreparedTrellisEvent<Types.AuthSessionsRevokedEvent>,
        ValidationError | UnexpectedError
      >;
      listen(
        handler: ServiceOwnedEventHandler<
          typeof sdk,
          "Auth.Sessions.Revoked",
          TDeps
        >,
        subjectData?: Record<string, unknown>,
        opts?: EventOpts,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
    };
  };
  readonly health: {
    heartbeat: {
      publish(
        event: HealthSdk.HealthHeartbeatEvent,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
      prepare(
        event: HealthSdk.HealthHeartbeatEvent,
      ): Result<
        PreparedTrellisEvent<HealthSdk.HealthHeartbeatEvent>,
        ValidationError | UnexpectedError
      >;
      listen(
        handler: DependencyServiceEventHandler<
          HealthSdk.HealthHeartbeatEvent,
          TDeps
        >,
        subjectData?: Record<string, unknown>,
        opts?: EventOpts,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
    };
  };
}

export interface ServiceHandle<TDeps = undefined> {
  readonly rpc: {
    readonly auth: {
      capabilitiesList(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Capabilities.List", TDeps>,
      ): Promise<void>;
      capabilityGroupsDelete(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.CapabilityGroups.Delete",
          TDeps
        >,
      ): Promise<void>;
      capabilityGroupsGet(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.CapabilityGroups.Get",
          TDeps
        >,
      ): Promise<void>;
      capabilityGroupsList(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.CapabilityGroups.List",
          TDeps
        >,
      ): Promise<void>;
      capabilityGroupsPut(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.CapabilityGroups.Put",
          TDeps
        >,
      ): Promise<void>;
      catalogIssuesResolve(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.CatalogIssues.Resolve",
          TDeps
        >,
      ): Promise<void>;
      connectionsKick(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Connections.Kick", TDeps>,
      ): Promise<void>;
      connectionsList(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Connections.List", TDeps>,
      ): Promise<void>;
      deploymentAuthorityAcceptMigration(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.DeploymentAuthority.AcceptMigration",
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityAcceptUpdate(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.DeploymentAuthority.AcceptUpdate",
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityGet(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.DeploymentAuthority.Get",
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityGrantOverridesList(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.DeploymentAuthority.GrantOverrides.List",
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityGrantOverridesPut(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.DeploymentAuthority.GrantOverrides.Put",
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityGrantOverridesRemove(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.DeploymentAuthority.GrantOverrides.Remove",
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityList(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.DeploymentAuthority.List",
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityPlan(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.DeploymentAuthority.Plan",
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityPlansGet(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.DeploymentAuthority.Plans.Get",
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityPlansList(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.DeploymentAuthority.Plans.List",
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityReconcile(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.DeploymentAuthority.Reconcile",
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityReject(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.DeploymentAuthority.Reject",
          TDeps
        >,
      ): Promise<void>;
      deploymentsCreate(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.Deployments.Create",
          TDeps
        >,
      ): Promise<void>;
      deploymentsDisable(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.Deployments.Disable",
          TDeps
        >,
      ): Promise<void>;
      deploymentsEnable(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.Deployments.Enable",
          TDeps
        >,
      ): Promise<void>;
      deploymentsList(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Deployments.List", TDeps>,
      ): Promise<void>;
      deploymentsRemove(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.Deployments.Remove",
          TDeps
        >,
      ): Promise<void>;
      deviceUserAuthoritiesList(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.DeviceUserAuthorities.List",
          TDeps
        >,
      ): Promise<void>;
      deviceUserAuthoritiesReviewsDecide(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.DeviceUserAuthorities.Reviews.Decide",
          TDeps
        >,
      ): Promise<void>;
      deviceUserAuthoritiesReviewsList(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.DeviceUserAuthorities.Reviews.List",
          TDeps
        >,
      ): Promise<void>;
      deviceUserAuthoritiesRevoke(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.DeviceUserAuthorities.Revoke",
          TDeps
        >,
      ): Promise<void>;
      devicesConnectInfoGet(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.Devices.ConnectInfo.Get",
          TDeps
        >,
      ): Promise<void>;
      devicesDisable(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Devices.Disable", TDeps>,
      ): Promise<void>;
      devicesEnable(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Devices.Enable", TDeps>,
      ): Promise<void>;
      devicesList(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Devices.List", TDeps>,
      ): Promise<void>;
      devicesProvision(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Devices.Provision", TDeps>,
      ): Promise<void>;
      devicesRemove(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Devices.Remove", TDeps>,
      ): Promise<void>;
      health(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Health", TDeps>,
      ): Promise<void>;
      identitiesList(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Identities.List", TDeps>,
      ): Promise<void>;
      identityGrantsList(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.IdentityGrants.List",
          TDeps
        >,
      ): Promise<void>;
      identityGrantsRevoke(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.IdentityGrants.Revoke",
          TDeps
        >,
      ): Promise<void>;
      portalsGet(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Portals.Get", TDeps>,
      ): Promise<void>;
      portalsList(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Portals.List", TDeps>,
      ): Promise<void>;
      portalsLoginSettingsGet(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.Portals.LoginSettings.Get",
          TDeps
        >,
      ): Promise<void>;
      portalsLoginSettingsUpdate(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.Portals.LoginSettings.Update",
          TDeps
        >,
      ): Promise<void>;
      portalsPut(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Portals.Put", TDeps>,
      ): Promise<void>;
      portalsRemove(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Portals.Remove", TDeps>,
      ): Promise<void>;
      portalsRoutesPut(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.Portals.Routes.Put",
          TDeps
        >,
      ): Promise<void>;
      portalsRoutesRemove(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.Portals.Routes.Remove",
          TDeps
        >,
      ): Promise<void>;
      requestsValidate(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Requests.Validate", TDeps>,
      ): Promise<void>;
      serviceInstancesDisable(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.ServiceInstances.Disable",
          TDeps
        >,
      ): Promise<void>;
      serviceInstancesEnable(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.ServiceInstances.Enable",
          TDeps
        >,
      ): Promise<void>;
      serviceInstancesList(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.ServiceInstances.List",
          TDeps
        >,
      ): Promise<void>;
      serviceInstancesProvision(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.ServiceInstances.Provision",
          TDeps
        >,
      ): Promise<void>;
      serviceInstancesRemove(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.ServiceInstances.Remove",
          TDeps
        >,
      ): Promise<void>;
      sessionsList(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Sessions.List", TDeps>,
      ): Promise<void>;
      sessionsLogout(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Sessions.Logout", TDeps>,
      ): Promise<void>;
      sessionsMe(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Sessions.Me", TDeps>,
      ): Promise<void>;
      sessionsRevoke(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Sessions.Revoke", TDeps>,
      ): Promise<void>;
      userIdentitiesList(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.UserIdentities.List",
          TDeps
        >,
      ): Promise<void>;
      userIdentitiesUnlink(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.UserIdentities.Unlink",
          TDeps
        >,
      ): Promise<void>;
      usersCreate(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Users.Create", TDeps>,
      ): Promise<void>;
      usersGet(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Users.Get", TDeps>,
      ): Promise<void>;
      usersIdentityLinkCreate(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.Users.IdentityLink.Create",
          TDeps
        >,
      ): Promise<void>;
      usersList(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Users.List", TDeps>,
      ): Promise<void>;
      usersPasswordChange(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.Users.Password.Change",
          TDeps
        >,
      ): Promise<void>;
      usersPasswordResetCreate(
        handler: ServiceRpcHandler<
          typeof sdk,
          "Auth.Users.PasswordReset.Create",
          TDeps
        >,
      ): Promise<void>;
      usersUpdate(
        handler: ServiceRpcHandler<typeof sdk, "Auth.Users.Update", TDeps>,
      ): Promise<void>;
    };
  };
  readonly feed: {};
  readonly operation: {
    readonly auth: {
      deviceUserAuthoritiesResolve:
        & ((
          handler: ServiceOperationHandler<
            typeof sdk,
            "Auth.DeviceUserAuthorities.Resolve",
            TDeps
          >,
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
