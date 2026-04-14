/**
 * Trellis Server package entry point.
 *
 * This package is server-only glue: it re-exports the RPC/event server runtime
 * plus common server helpers (health checks, subscription types).
 *
 * @module
 */

export { TrellisServer } from "@qlever-llc/trellis/server/runtime";
// Re-export health types
export {
  type HealthCheckFn,
  type HealthCheckResult,
  type HealthResponse,
  runAllHealthChecks,
  runHealthCheck,
} from "./health.ts";
export { mountStandardHealthRpc } from "./health_rpc.ts";
export {
  HealthCheckResultSchema,
  HealthResponseSchema,
  HealthRpcSchema,
} from "./health_schemas.ts";
export type {
  NatsConnectFn,
  NatsConnectOpts,
  ReadFileSyncFn,
  TrellisServiceRuntimeDeps,
} from "./runtime.ts";
export {
  KVHandle,
  type ResourceBindingKV,
  type ResourceBindings,
  type ResourceBindingStore,
  type ResourceBindingStream,
  type ServiceContract,
  type ServiceHandlerTransfer,
  type ServiceHandlerTrellis,
  type ServiceRpcHandler,
  type ServiceTrellis,
  StoreHandle,
  TrellisService,
  type TrellisServiceConnectOpts,
} from "./service.ts";
export { ServiceTransfer } from "./transfer.ts";
export type {
  InitiateDownloadArgs,
  InitiateUploadArgs,
  TransferStoreHandle,
} from "./transfer.ts";

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
