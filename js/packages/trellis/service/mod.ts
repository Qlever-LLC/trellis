/**
 * Trellis service authoring entry point.
 *
 * This subpath exposes the service wrapper and service-side helpers without the
 * low-level runtime used by the internal server package.
 *
 * @module
 */

export {
  createHealthHeartbeat,
  type HealthCheckFn,
  type HealthCheckResult,
  type HealthHeartbeat,
  type HealthResponse,
  runAllHealthChecks,
  runAllServiceHealthChecks,
  runHealthCheck,
  runServiceHealthCheck,
  ServiceHealth,
  type ServiceHealthCheck,
  type ServiceHealthCheckFn,
  type ServiceHealthInfo,
  type ServiceHealthInfoFn,
} from "../server/health.ts";
export { mountStandardHealthRpc } from "../server/health_rpc.ts";
export {
  HealthCheckResultSchema,
  HealthHeartbeatHeaderSchema,
  HealthHeartbeatSchema,
  HealthHeartbeatServiceSchema,
  HealthInfoSchema,
  HealthResponseSchema,
  HealthRpcSchema,
} from "../server/health_schemas.ts";
export {
  type JobArgs,
  type JobHandler,
  type JobQueue,
  type JobResult,
  type JobsFacadeOf,
  type OperationHandler,
  type OperationRegistration,
  type ResourceBindingKV,
  type ResourceBindings,
  type ResourceBindingStore,
  type ResourceBindingStream,
  type RpcHandler,
  type ServiceContract,
  type ServiceTrellis,
  StoreHandle,
  type Trellis,
  TrellisService,
  type TrellisServiceConnectOpts,
} from "../server/service.ts";
export {
  createEventContext,
  type EventContext,
  type EventHandler,
  type GroupedSubscription,
  isGroupedSubscription,
  type MultiEventSubscription,
  type MultiSubscribeOpts,
  type OrderingGroup,
  type SingleSubscription,
  type SubscribeOpts,
} from "../server/subscription.ts";
