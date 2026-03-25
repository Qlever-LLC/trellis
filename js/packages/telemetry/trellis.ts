import { configureErrorTraceId } from "./result.ts";
import { initTelemetry } from "./runtime.ts";

export { getTrellisTracer, startClientSpan, startServerSpan } from "./trace.ts";

export function initTracing(serviceName: string): void {
  configureErrorTraceId();
  initTelemetry(serviceName);
}
