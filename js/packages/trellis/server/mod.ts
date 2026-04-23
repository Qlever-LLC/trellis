/**
 * Trellis service package entry point.
 *
 * This package is service-side glue: it re-exports the RPC/event hosting runtime
 * plus common service helpers (health checks, subscription types).
 *
 * @module
 */

export { TrellisServer } from "../server.ts";
// Re-export health types
export {
  type HealthHeartbeat,
  type HealthCheckFn,
  type HealthCheckResult,
  type HealthResponse,
  type ServiceHealthInfoFn,
  type ServiceHealthCheck,
  type ServiceHealthCheckFn,
  type ServiceHealthInfo,
  createHealthHeartbeat,
  runAllHealthChecks,
  runAllServiceHealthChecks,
  runHealthCheck,
  runServiceHealthCheck,
  ServiceHealth,
} from "./health.ts";
export { mountStandardHealthRpc } from "./health_rpc.ts";
export {
  HealthHeartbeatHeaderSchema,
  HealthHeartbeatSchema,
  HealthHeartbeatServiceSchema,
  HealthCheckResultSchema,
  HealthInfoSchema,
  HealthResponseSchema,
  HealthRpcSchema,
} from "./health_schemas.ts";
export {
  type JobQueue,
  type JobHandler,
  type JobsFacadeOf,
  type OperationRegistration,
  type OperationHandler,
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
} from "./service.ts";

// Re-export subscription types
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
} from "./subscription.ts";
