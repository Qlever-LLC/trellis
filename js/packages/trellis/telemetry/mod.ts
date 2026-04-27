export type { HeaderCarrier } from "./carrier.ts";
export {
  createMapCarrier,
  extractTraceContext,
  injectTraceContext,
} from "./carrier.ts";
export type { Context, Span } from "./core.ts";
export {
  context,
  getActiveSpan,
  getTracer,
  SpanKind,
  SpanStatusCode,
  trace,
  withSpan,
  withSpanAsync,
} from "./core.ts";
export { getEnv } from "./env.ts";
export type { NatsHeadersLike } from "./nats.ts";
export { createNatsHeaderCarrier } from "./nats.ts";
export { configureErrorTraceId } from "./result.ts";
export {
  getTrellisTracer,
  startClientSpan,
  startServerSpan,
} from "./trellis.ts";
