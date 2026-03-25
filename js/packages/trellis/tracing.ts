// Keep this subpath for Trellis-specific tracing convenience without exposing
// telemetry from the root `@trellis/trellis` package surface.
export type { HeaderCarrier, NatsHeadersLike } from "@trellis/telemetry";
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
} from "@trellis/telemetry";
export function initTracing(serviceName: string): void {
  void import("@trellis/telemetry").then((mod) => mod.initTracing(serviceName));
}
