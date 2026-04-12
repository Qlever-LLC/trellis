import { configureErrorTraceId } from "./result.ts";
import { initTelemetry } from "./runtime.ts";

export function initTracing(serviceName: string): void {
  configureErrorTraceId();
  initTelemetry(serviceName);
}

export { initTelemetry };
