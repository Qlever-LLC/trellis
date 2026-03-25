// Keep this subpath for Trellis-specific tracing convenience without exposing
// telemetry from the root `@trellis/trellis` package surface.
export type { HeaderCarrier, NatsHeadersLike } from "@trellis/telemetry";
export {
  context,
  createMapCarrier,
  createNatsHeaderCarrier,
  extractTraceContext,
  getActiveSpan,
  injectTraceContext,
  SpanKind,
  SpanStatusCode,
  trace,
  withSpan,
  withSpanAsync,
} from "@trellis/telemetry";
export { configureErrorTraceId } from "@trellis/telemetry/result";
export { getTrellisTracer as getTracer, startClientSpan, startServerSpan } from "@trellis/telemetry/trace";
export function initTracing(serviceName: string): void {
  void import("@trellis/telemetry/trellis").then((mod) => mod.initTracing(serviceName));
}
