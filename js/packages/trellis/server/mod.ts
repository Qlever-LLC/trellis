/**
 * Trellis service package entry point.
 *
 * This package is service-side glue: it re-exports the RPC/event hosting runtime
 * plus common service helpers (health checks, subscription types).
 *
 * @module
 */

export { TrellisServiceRuntime } from "../server.ts";
export type { TrellisServiceRuntimeFor } from "../server.ts";
// Re-export health types
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
} from "./health.ts";
export { mountStandardHealthRpc } from "./health_rpc.ts";
export {
  HealthCheckResultSchema,
  HealthHeartbeatHeaderSchema,
  HealthHeartbeatSchema,
  HealthHeartbeatServiceSchema,
  HealthInfoSchema,
  HealthResponseSchema,
  HealthRpcSchema,
} from "./health_schemas.ts";
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
