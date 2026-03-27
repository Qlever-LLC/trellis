// Keep this subpath for Trellis-specific tracing convenience without exposing
// telemetry from the root `@qlever-llc/trellis` package surface.
export type { HeaderCarrier, NatsHeadersLike } from "@qlever-llc/trellis-telemetry";
export {configureErrorTraceId, 
  context,
  createMapCarrier,
  createNatsHeaderCarrier,
  extractTraceContext,
  getActiveSpan,getTrellisTracer as getTracer, 
  injectTraceContext,
  SpanKind,
  SpanStatusCode,startClientSpan, startServerSpan, 
  trace,
  withSpan,
  withSpanAsync
} from "@qlever-llc/trellis-telemetry";
export function initTracing(serviceName: string): void {
  void import("@qlever-llc/trellis-telemetry").then((mod) => mod.initTracing(serviceName));
}
