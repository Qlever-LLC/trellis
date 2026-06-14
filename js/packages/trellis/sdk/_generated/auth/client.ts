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
  OperationTransferHandle,
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
} from "../../../index.ts";
import type { API, Api } from "./api.ts";
import type * as Types from "./types.ts";

type WithDeps<TDeps> = [TDeps] extends [undefined] ? {} : { deps: TDeps };

type EventCallback<TMessage> = {
  bivarianceHack(
    message: TMessage,
    context: EventListenerContext,
  ): MaybeAsync<void, BaseError>;
}["bivarianceHack"];

type ServiceEventHandler<TEvent, TDeps = undefined> = (
  args:
    & { event: TEvent; context: EventListenerContext; client: HandlerClient }
    & WithDeps<TDeps>,
) => MaybeAsync<void, BaseError>;

type RpcHandler<TInput, TOutput, TDeps = undefined> = (
  args:
    & { input: TInput; context: RpcHandlerContext; client: HandlerClient }
    & WithDeps<TDeps>,
) => MaybeAsync<TOutput, BaseError>;

type FeedHandler<TInput, TEvent, TDeps = undefined> = (
  context: {
    input: TInput;
    caller: unknown;
    signal: AbortSignal;
    emit(event: TEvent): AsyncResult<void, ValidationError | UnexpectedError>;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => unknown | Promise<unknown>;

type OperationHandler<
  TInput,
  TProgress,
  TOutput,
  TTransfer,
  TDeps = undefined,
> = (
  context:
    & {
      input: TInput;
      op: OperationRuntimeHandle<TProgress, TOutput>;
      caller: unknown;
      client: HandlerClient;
    }
    & TTransfer
    & WithDeps<TDeps>,
) => unknown | Promise<unknown>;

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
        event: Omit<Types.AuthConnectionsClosedEvent, "header">,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
      prepare(
        event: Omit<Types.AuthConnectionsClosedEvent, "header">,
      ): Result<
        PreparedTrellisEvent<Omit<Types.AuthConnectionsClosedEvent, "header">>,
        ValidationError | UnexpectedError
      >;
      listen(
        handler: ServiceEventHandler<Types.AuthConnectionsClosedEvent, TDeps>,
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
        PreparedTrellisEvent<Omit<Types.AuthConnectionsKickedEvent, "header">>,
        ValidationError | UnexpectedError
      >;
      listen(
        handler: ServiceEventHandler<Types.AuthConnectionsKickedEvent, TDeps>,
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
        PreparedTrellisEvent<Omit<Types.AuthConnectionsOpenedEvent, "header">>,
        ValidationError | UnexpectedError
      >;
      listen(
        handler: ServiceEventHandler<Types.AuthConnectionsOpenedEvent, TDeps>,
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
        handler: ServiceEventHandler<
          Types.AuthDeviceUserAuthoritiesApprovedEvent,
          TDeps
        >,
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
        handler: ServiceEventHandler<
          Types.AuthDeviceUserAuthoritiesRequestedEvent,
          TDeps
        >,
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
        handler: ServiceEventHandler<
          Types.AuthDeviceUserAuthoritiesResolvedEvent,
          TDeps
        >,
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
        handler: ServiceEventHandler<
          Types.AuthDeviceUserAuthoritiesReviewRequestedEvent,
          TDeps
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
        handler: ServiceEventHandler<Types.AuthSessionsRevokedEvent, TDeps>,
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
        handler: RpcHandler<
          Types.AuthCapabilitiesListInput,
          Types.AuthCapabilitiesListOutput,
          TDeps
        >,
      ): Promise<void>;
      capabilityGroupsDelete(
        handler: RpcHandler<
          Types.AuthCapabilityGroupsDeleteInput,
          Types.AuthCapabilityGroupsDeleteOutput,
          TDeps
        >,
      ): Promise<void>;
      capabilityGroupsGet(
        handler: RpcHandler<
          Types.AuthCapabilityGroupsGetInput,
          Types.AuthCapabilityGroupsGetOutput,
          TDeps
        >,
      ): Promise<void>;
      capabilityGroupsList(
        handler: RpcHandler<
          Types.AuthCapabilityGroupsListInput,
          Types.AuthCapabilityGroupsListOutput,
          TDeps
        >,
      ): Promise<void>;
      capabilityGroupsPut(
        handler: RpcHandler<
          Types.AuthCapabilityGroupsPutInput,
          Types.AuthCapabilityGroupsPutOutput,
          TDeps
        >,
      ): Promise<void>;
      catalogIssuesResolve(
        handler: RpcHandler<
          Types.AuthCatalogIssuesResolveInput,
          Types.AuthCatalogIssuesResolveOutput,
          TDeps
        >,
      ): Promise<void>;
      connectionsKick(
        handler: RpcHandler<
          Types.AuthConnectionsKickInput,
          Types.AuthConnectionsKickOutput,
          TDeps
        >,
      ): Promise<void>;
      connectionsList(
        handler: RpcHandler<
          Types.AuthConnectionsListInput,
          Types.AuthConnectionsListOutput,
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityAcceptMigration(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityAcceptMigrationInput,
          Types.AuthDeploymentAuthorityAcceptMigrationOutput,
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityAcceptUpdate(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityAcceptUpdateInput,
          Types.AuthDeploymentAuthorityAcceptUpdateOutput,
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityGet(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityGetInput,
          Types.AuthDeploymentAuthorityGetOutput,
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityGrantOverridesList(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityGrantOverridesListInput,
          Types.AuthDeploymentAuthorityGrantOverridesListOutput,
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityGrantOverridesPut(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityGrantOverridesPutInput,
          Types.AuthDeploymentAuthorityGrantOverridesPutOutput,
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityGrantOverridesRemove(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityGrantOverridesRemoveInput,
          Types.AuthDeploymentAuthorityGrantOverridesRemoveOutput,
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityList(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityListInput,
          Types.AuthDeploymentAuthorityListOutput,
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityPlan(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityPlanInput,
          Types.AuthDeploymentAuthorityPlanOutput,
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityPlansGet(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityPlansGetInput,
          Types.AuthDeploymentAuthorityPlansGetOutput,
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityPlansList(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityPlansListInput,
          Types.AuthDeploymentAuthorityPlansListOutput,
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityReconcile(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityReconcileInput,
          Types.AuthDeploymentAuthorityReconcileOutput,
          TDeps
        >,
      ): Promise<void>;
      deploymentAuthorityReject(
        handler: RpcHandler<
          Types.AuthDeploymentAuthorityRejectInput,
          Types.AuthDeploymentAuthorityRejectOutput,
          TDeps
        >,
      ): Promise<void>;
      deploymentsCreate(
        handler: RpcHandler<
          Types.AuthDeploymentsCreateInput,
          Types.AuthDeploymentsCreateOutput,
          TDeps
        >,
      ): Promise<void>;
      deploymentsDisable(
        handler: RpcHandler<
          Types.AuthDeploymentsDisableInput,
          Types.AuthDeploymentsDisableOutput,
          TDeps
        >,
      ): Promise<void>;
      deploymentsEnable(
        handler: RpcHandler<
          Types.AuthDeploymentsEnableInput,
          Types.AuthDeploymentsEnableOutput,
          TDeps
        >,
      ): Promise<void>;
      deploymentsList(
        handler: RpcHandler<
          Types.AuthDeploymentsListInput,
          Types.AuthDeploymentsListOutput,
          TDeps
        >,
      ): Promise<void>;
      deploymentsRemove(
        handler: RpcHandler<
          Types.AuthDeploymentsRemoveInput,
          Types.AuthDeploymentsRemoveOutput,
          TDeps
        >,
      ): Promise<void>;
      deviceUserAuthoritiesList(
        handler: RpcHandler<
          Types.AuthDeviceUserAuthoritiesListInput,
          Types.AuthDeviceUserAuthoritiesListOutput,
          TDeps
        >,
      ): Promise<void>;
      deviceUserAuthoritiesReviewsDecide(
        handler: RpcHandler<
          Types.AuthDeviceUserAuthoritiesReviewsDecideInput,
          Types.AuthDeviceUserAuthoritiesReviewsDecideOutput,
          TDeps
        >,
      ): Promise<void>;
      deviceUserAuthoritiesReviewsList(
        handler: RpcHandler<
          Types.AuthDeviceUserAuthoritiesReviewsListInput,
          Types.AuthDeviceUserAuthoritiesReviewsListOutput,
          TDeps
        >,
      ): Promise<void>;
      deviceUserAuthoritiesRevoke(
        handler: RpcHandler<
          Types.AuthDeviceUserAuthoritiesRevokeInput,
          Types.AuthDeviceUserAuthoritiesRevokeOutput,
          TDeps
        >,
      ): Promise<void>;
      devicesConnectInfoGet(
        handler: RpcHandler<
          Types.AuthDevicesConnectInfoGetInput,
          Types.AuthDevicesConnectInfoGetOutput,
          TDeps
        >,
      ): Promise<void>;
      devicesDisable(
        handler: RpcHandler<
          Types.AuthDevicesDisableInput,
          Types.AuthDevicesDisableOutput,
          TDeps
        >,
      ): Promise<void>;
      devicesEnable(
        handler: RpcHandler<
          Types.AuthDevicesEnableInput,
          Types.AuthDevicesEnableOutput,
          TDeps
        >,
      ): Promise<void>;
      devicesList(
        handler: RpcHandler<
          Types.AuthDevicesListInput,
          Types.AuthDevicesListOutput,
          TDeps
        >,
      ): Promise<void>;
      devicesProvision(
        handler: RpcHandler<
          Types.AuthDevicesProvisionInput,
          Types.AuthDevicesProvisionOutput,
          TDeps
        >,
      ): Promise<void>;
      devicesRemove(
        handler: RpcHandler<
          Types.AuthDevicesRemoveInput,
          Types.AuthDevicesRemoveOutput,
          TDeps
        >,
      ): Promise<void>;
      health(
        handler: RpcHandler<
          Types.AuthHealthInput,
          Types.AuthHealthOutput,
          TDeps
        >,
      ): Promise<void>;
      identitiesList(
        handler: RpcHandler<
          Types.AuthIdentitiesListInput,
          Types.AuthIdentitiesListOutput,
          TDeps
        >,
      ): Promise<void>;
      identityGrantsList(
        handler: RpcHandler<
          Types.AuthIdentityGrantsListInput,
          Types.AuthIdentityGrantsListOutput,
          TDeps
        >,
      ): Promise<void>;
      identityGrantsRevoke(
        handler: RpcHandler<
          Types.AuthIdentityGrantsRevokeInput,
          Types.AuthIdentityGrantsRevokeOutput,
          TDeps
        >,
      ): Promise<void>;
      portalsGet(
        handler: RpcHandler<
          Types.AuthPortalsGetInput,
          Types.AuthPortalsGetOutput,
          TDeps
        >,
      ): Promise<void>;
      portalsList(
        handler: RpcHandler<
          Types.AuthPortalsListInput,
          Types.AuthPortalsListOutput,
          TDeps
        >,
      ): Promise<void>;
      portalsLoginSettingsGet(
        handler: RpcHandler<
          Types.AuthPortalsLoginSettingsGetInput,
          Types.AuthPortalsLoginSettingsGetOutput,
          TDeps
        >,
      ): Promise<void>;
      portalsLoginSettingsUpdate(
        handler: RpcHandler<
          Types.AuthPortalsLoginSettingsUpdateInput,
          Types.AuthPortalsLoginSettingsUpdateOutput,
          TDeps
        >,
      ): Promise<void>;
      portalsPut(
        handler: RpcHandler<
          Types.AuthPortalsPutInput,
          Types.AuthPortalsPutOutput,
          TDeps
        >,
      ): Promise<void>;
      portalsRemove(
        handler: RpcHandler<
          Types.AuthPortalsRemoveInput,
          Types.AuthPortalsRemoveOutput,
          TDeps
        >,
      ): Promise<void>;
      portalsRoutesPut(
        handler: RpcHandler<
          Types.AuthPortalsRoutesPutInput,
          Types.AuthPortalsRoutesPutOutput,
          TDeps
        >,
      ): Promise<void>;
      portalsRoutesRemove(
        handler: RpcHandler<
          Types.AuthPortalsRoutesRemoveInput,
          Types.AuthPortalsRoutesRemoveOutput,
          TDeps
        >,
      ): Promise<void>;
      requestsValidate(
        handler: RpcHandler<
          Types.AuthRequestsValidateInput,
          Types.AuthRequestsValidateOutput,
          TDeps
        >,
      ): Promise<void>;
      serviceInstancesDisable(
        handler: RpcHandler<
          Types.AuthServiceInstancesDisableInput,
          Types.AuthServiceInstancesDisableOutput,
          TDeps
        >,
      ): Promise<void>;
      serviceInstancesEnable(
        handler: RpcHandler<
          Types.AuthServiceInstancesEnableInput,
          Types.AuthServiceInstancesEnableOutput,
          TDeps
        >,
      ): Promise<void>;
      serviceInstancesList(
        handler: RpcHandler<
          Types.AuthServiceInstancesListInput,
          Types.AuthServiceInstancesListOutput,
          TDeps
        >,
      ): Promise<void>;
      serviceInstancesProvision(
        handler: RpcHandler<
          Types.AuthServiceInstancesProvisionInput,
          Types.AuthServiceInstancesProvisionOutput,
          TDeps
        >,
      ): Promise<void>;
      serviceInstancesRemove(
        handler: RpcHandler<
          Types.AuthServiceInstancesRemoveInput,
          Types.AuthServiceInstancesRemoveOutput,
          TDeps
        >,
      ): Promise<void>;
      sessionsList(
        handler: RpcHandler<
          Types.AuthSessionsListInput,
          Types.AuthSessionsListOutput,
          TDeps
        >,
      ): Promise<void>;
      sessionsLogout(
        handler: RpcHandler<
          Types.AuthSessionsLogoutInput,
          Types.AuthSessionsLogoutOutput,
          TDeps
        >,
      ): Promise<void>;
      sessionsMe(
        handler: RpcHandler<
          Types.AuthSessionsMeInput,
          Types.AuthSessionsMeOutput,
          TDeps
        >,
      ): Promise<void>;
      sessionsRevoke(
        handler: RpcHandler<
          Types.AuthSessionsRevokeInput,
          Types.AuthSessionsRevokeOutput,
          TDeps
        >,
      ): Promise<void>;
      userIdentitiesList(
        handler: RpcHandler<
          Types.AuthUserIdentitiesListInput,
          Types.AuthUserIdentitiesListOutput,
          TDeps
        >,
      ): Promise<void>;
      userIdentitiesUnlink(
        handler: RpcHandler<
          Types.AuthUserIdentitiesUnlinkInput,
          Types.AuthUserIdentitiesUnlinkOutput,
          TDeps
        >,
      ): Promise<void>;
      usersCreate(
        handler: RpcHandler<
          Types.AuthUsersCreateInput,
          Types.AuthUsersCreateOutput,
          TDeps
        >,
      ): Promise<void>;
      usersGet(
        handler: RpcHandler<
          Types.AuthUsersGetInput,
          Types.AuthUsersGetOutput,
          TDeps
        >,
      ): Promise<void>;
      usersIdentityLinkCreate(
        handler: RpcHandler<
          Types.AuthUsersIdentityLinkCreateInput,
          Types.AuthUsersIdentityLinkCreateOutput,
          TDeps
        >,
      ): Promise<void>;
      usersList(
        handler: RpcHandler<
          Types.AuthUsersListInput,
          Types.AuthUsersListOutput,
          TDeps
        >,
      ): Promise<void>;
      usersPasswordChange(
        handler: RpcHandler<
          Types.AuthUsersPasswordChangeInput,
          Types.AuthUsersPasswordChangeOutput,
          TDeps
        >,
      ): Promise<void>;
      usersPasswordResetCreate(
        handler: RpcHandler<
          Types.AuthUsersPasswordResetCreateInput,
          Types.AuthUsersPasswordResetCreateOutput,
          TDeps
        >,
      ): Promise<void>;
      usersUpdate(
        handler: RpcHandler<
          Types.AuthUsersUpdateInput,
          Types.AuthUsersUpdateOutput,
          TDeps
        >,
      ): Promise<void>;
    };
  };
  readonly feed: {};
  readonly operation: {
    readonly auth: {
      deviceUserAuthoritiesResolve:
        & ((
          handler: OperationHandler<
            Types.AuthDeviceUserAuthoritiesResolveInput,
            Types.AuthDeviceUserAuthoritiesResolveProgress,
            Types.AuthDeviceUserAuthoritiesResolveOutput,
            {},
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
