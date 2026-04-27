// Keep this subpath for Trellis-specific tracing convenience without exposing
// telemetry from the root `@qlever-llc/trellis` package surface.
export type { HeaderCarrier, NatsHeadersLike } from "./telemetry/mod.ts";
export {
  configureErrorTraceId,
  context,
  createMapCarrier,
  createNatsHeaderCarrier,
  extractTraceContext,
  getActiveSpan,
  getTrellisTracer as getTracer,
  injectTraceContext,
  SpanKind,
  SpanStatusCode,
  startClientSpan,
  startServerSpan,
  trace,
  withSpan,
  withSpanAsync,
} from "./telemetry/mod.ts";
export function initTracing(serviceName: string): void {
  void import("./telemetry/init.ts").then((mod) =>
    mod.initTracing(serviceName)
  );
}
