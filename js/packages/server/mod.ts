/**
 * Trellis Server package entry point.
 *
 * This package is server-only glue: it re-exports the RPC/event server runtime
 * plus common server helpers (health checks, subscription types).
 *
 * @module
 */

export { TrellisServer } from "@trellis/trellis";
export {
  connectService as connectDenoService,
} from "./deno.ts";
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
export {
  connectService as connectNodeService,
} from "./node.ts";
export type {
  NatsConnectFn,
  NatsConnectOpts,
  ReadFileSyncFn,
  TrellisServiceRuntimeDeps,
} from "./runtime.ts";
export {
  connectService,
  KVHandle,
  type ResourceBindingKV,
  type ResourceBindingStream,
  type ResourceBindings,
  type ServiceContract,
  type ServiceTrellis,
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
