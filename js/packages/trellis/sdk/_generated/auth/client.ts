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
import type * as HealthSdk from "../health/mod.ts";

type EventCallback<TMessage> = {
  bivarianceHack(
    message: TMessage,
    context: EventListenerContext,
  ): MaybeAsync<void, BaseError>;
}["bivarianceHack"];

type DependencyServiceEventHandler<TEvent> = (
  args: { event: TEvent; context: EventListenerContext; client: HandlerClient },
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
}

export interface ServiceEventSurface {
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
        handler: Types.AuthConnectionsClosedEventHandler,
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
        handler: Types.AuthConnectionsKickedEventHandler,
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
        handler: Types.AuthConnectionsOpenedEventHandler,
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
        handler: Types.AuthDeviceUserAuthoritiesApprovedEventHandler,
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
        handler: Types.AuthDeviceUserAuthoritiesRequestedEventHandler,
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
        handler: Types.AuthDeviceUserAuthoritiesResolvedEventHandler,
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
        handler: Types.AuthDeviceUserAuthoritiesReviewRequestedEventHandler,
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
        handler: Types.AuthSessionsRevokedEventHandler,
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
        handler: DependencyServiceEventHandler<HealthSdk.HealthHeartbeatEvent>,
        subjectData?: Record<string, unknown>,
        opts?: EventOpts,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
    };
  };
}

export interface ServiceHandle {
  readonly rpc: {
    readonly auth: {
      capabilitiesList(
        handler: Types.AuthCapabilitiesListHandler,
      ): Promise<void>;
      capabilityGroupsDelete(
        handler: Types.AuthCapabilityGroupsDeleteHandler,
      ): Promise<void>;
      capabilityGroupsGet(
        handler: Types.AuthCapabilityGroupsGetHandler,
      ): Promise<void>;
      capabilityGroupsList(
        handler: Types.AuthCapabilityGroupsListHandler,
      ): Promise<void>;
      capabilityGroupsPut(
        handler: Types.AuthCapabilityGroupsPutHandler,
      ): Promise<void>;
      catalogIssuesResolve(
        handler: Types.AuthCatalogIssuesResolveHandler,
      ): Promise<void>;
      connectionsKick(handler: Types.AuthConnectionsKickHandler): Promise<void>;
      connectionsList(handler: Types.AuthConnectionsListHandler): Promise<void>;
      deploymentAuthorityAcceptMigration(
        handler: Types.AuthDeploymentAuthorityAcceptMigrationHandler,
      ): Promise<void>;
      deploymentAuthorityAcceptUpdate(
        handler: Types.AuthDeploymentAuthorityAcceptUpdateHandler,
      ): Promise<void>;
      deploymentAuthorityGet(
        handler: Types.AuthDeploymentAuthorityGetHandler,
      ): Promise<void>;
      deploymentAuthorityGrantOverridesList(
        handler: Types.AuthDeploymentAuthorityGrantOverridesListHandler,
      ): Promise<void>;
      deploymentAuthorityGrantOverridesPut(
        handler: Types.AuthDeploymentAuthorityGrantOverridesPutHandler,
      ): Promise<void>;
      deploymentAuthorityGrantOverridesRemove(
        handler: Types.AuthDeploymentAuthorityGrantOverridesRemoveHandler,
      ): Promise<void>;
      deploymentAuthorityList(
        handler: Types.AuthDeploymentAuthorityListHandler,
      ): Promise<void>;
      deploymentAuthorityPlan(
        handler: Types.AuthDeploymentAuthorityPlanHandler,
      ): Promise<void>;
      deploymentAuthorityPlansGet(
        handler: Types.AuthDeploymentAuthorityPlansGetHandler,
      ): Promise<void>;
      deploymentAuthorityPlansList(
        handler: Types.AuthDeploymentAuthorityPlansListHandler,
      ): Promise<void>;
      deploymentAuthorityReconcile(
        handler: Types.AuthDeploymentAuthorityReconcileHandler,
      ): Promise<void>;
      deploymentAuthorityReject(
        handler: Types.AuthDeploymentAuthorityRejectHandler,
      ): Promise<void>;
      deploymentsCreate(
        handler: Types.AuthDeploymentsCreateHandler,
      ): Promise<void>;
      deploymentsDisable(
        handler: Types.AuthDeploymentsDisableHandler,
      ): Promise<void>;
      deploymentsEnable(
        handler: Types.AuthDeploymentsEnableHandler,
      ): Promise<void>;
      deploymentsList(handler: Types.AuthDeploymentsListHandler): Promise<void>;
      deploymentsRemove(
        handler: Types.AuthDeploymentsRemoveHandler,
      ): Promise<void>;
      deviceUserAuthoritiesList(
        handler: Types.AuthDeviceUserAuthoritiesListHandler,
      ): Promise<void>;
      deviceUserAuthoritiesReviewsDecide(
        handler: Types.AuthDeviceUserAuthoritiesReviewsDecideHandler,
      ): Promise<void>;
      deviceUserAuthoritiesReviewsList(
        handler: Types.AuthDeviceUserAuthoritiesReviewsListHandler,
      ): Promise<void>;
      deviceUserAuthoritiesRevoke(
        handler: Types.AuthDeviceUserAuthoritiesRevokeHandler,
      ): Promise<void>;
      devicesConnectInfoGet(
        handler: Types.AuthDevicesConnectInfoGetHandler,
      ): Promise<void>;
      devicesDisable(handler: Types.AuthDevicesDisableHandler): Promise<void>;
      devicesEnable(handler: Types.AuthDevicesEnableHandler): Promise<void>;
      devicesList(handler: Types.AuthDevicesListHandler): Promise<void>;
      devicesProvision(
        handler: Types.AuthDevicesProvisionHandler,
      ): Promise<void>;
      devicesRemove(handler: Types.AuthDevicesRemoveHandler): Promise<void>;
      health(handler: Types.AuthHealthHandler): Promise<void>;
      identitiesList(handler: Types.AuthIdentitiesListHandler): Promise<void>;
      identityGrantsList(
        handler: Types.AuthIdentityGrantsListHandler,
      ): Promise<void>;
      identityGrantsRevoke(
        handler: Types.AuthIdentityGrantsRevokeHandler,
      ): Promise<void>;
      portalsGet(handler: Types.AuthPortalsGetHandler): Promise<void>;
      portalsList(handler: Types.AuthPortalsListHandler): Promise<void>;
      portalsLoginSettingsGet(
        handler: Types.AuthPortalsLoginSettingsGetHandler,
      ): Promise<void>;
      portalsLoginSettingsUpdate(
        handler: Types.AuthPortalsLoginSettingsUpdateHandler,
      ): Promise<void>;
      portalsPut(handler: Types.AuthPortalsPutHandler): Promise<void>;
      portalsRemove(handler: Types.AuthPortalsRemoveHandler): Promise<void>;
      portalsRoutesPut(
        handler: Types.AuthPortalsRoutesPutHandler,
      ): Promise<void>;
      portalsRoutesRemove(
        handler: Types.AuthPortalsRoutesRemoveHandler,
      ): Promise<void>;
      requestsValidate(
        handler: Types.AuthRequestsValidateHandler,
      ): Promise<void>;
      serviceInstancesDisable(
        handler: Types.AuthServiceInstancesDisableHandler,
      ): Promise<void>;
      serviceInstancesEnable(
        handler: Types.AuthServiceInstancesEnableHandler,
      ): Promise<void>;
      serviceInstancesList(
        handler: Types.AuthServiceInstancesListHandler,
      ): Promise<void>;
      serviceInstancesProvision(
        handler: Types.AuthServiceInstancesProvisionHandler,
      ): Promise<void>;
      serviceInstancesRemove(
        handler: Types.AuthServiceInstancesRemoveHandler,
      ): Promise<void>;
      sessionsList(handler: Types.AuthSessionsListHandler): Promise<void>;
      sessionsLogout(handler: Types.AuthSessionsLogoutHandler): Promise<void>;
      sessionsMe(handler: Types.AuthSessionsMeHandler): Promise<void>;
      sessionsRevoke(handler: Types.AuthSessionsRevokeHandler): Promise<void>;
      userIdentitiesList(
        handler: Types.AuthUserIdentitiesListHandler,
      ): Promise<void>;
      userIdentitiesUnlink(
        handler: Types.AuthUserIdentitiesUnlinkHandler,
      ): Promise<void>;
      usersCreate(handler: Types.AuthUsersCreateHandler): Promise<void>;
      usersGet(handler: Types.AuthUsersGetHandler): Promise<void>;
      usersIdentityLinkCreate(
        handler: Types.AuthUsersIdentityLinkCreateHandler,
      ): Promise<void>;
      usersList(handler: Types.AuthUsersListHandler): Promise<void>;
      usersPasswordChange(
        handler: Types.AuthUsersPasswordChangeHandler,
      ): Promise<void>;
      usersPasswordResetCreate(
        handler: Types.AuthUsersPasswordResetCreateHandler,
      ): Promise<void>;
      usersUpdate(handler: Types.AuthUsersUpdateHandler): Promise<void>;
    };
  };
  readonly feed: {};
  readonly operation: {
    readonly auth: {
      deviceUserAuthoritiesResolve:
        & ((
          handler: Types.AuthDeviceUserAuthoritiesResolveOperationHandler,
        ) => Promise<void>)
        & {
          accept(
            args: { sessionKey: string },
          ): AsyncResult<
            AcceptedOperation<
              Types.AuthDeviceUserAuthoritiesResolveProgress,
              Types.AuthDeviceUserAuthoritiesResolveOutput,
              Types.AuthDeviceUserAuthoritiesResolveOperationHandlerError
            >,
            UnexpectedError
          >;
          control(
            operationId: string,
          ): AsyncResult<
            OperationRuntimeHandle<
              Types.AuthDeviceUserAuthoritiesResolveProgress,
              Types.AuthDeviceUserAuthoritiesResolveOutput,
              Types.AuthDeviceUserAuthoritiesResolveOperationHandlerError
            >,
            BaseError
          >;
        };
    };
  };
}

export type HandlerClient = HandlerTrellis<Api>;
export type Client = TrellisAuthClient;
