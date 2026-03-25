/**
 * Health check types and utility functions for Trellis services.
 *
 * This module provides a standardized way to implement health checks
 * for services, with support for individual check results and
 * aggregated health status (healthy, degraded, unhealthy).
 *
 * @module
 */

import { type Result } from "@trellis/result";
import { type TrellisError } from "@trellis/trellis";

/**
 * A health check function that returns a Result indicating health status.
 *
 * The function should return:
 * - `Result.ok(true)` when the check passes
 * - `Result.ok(false)` when the check fails without an error
 * - `Result.err(error)` when the check fails with an error
 */
export type HealthCheckFn = () => Promise<Result<boolean, TrellisError>>;

/**
 * Result of a single health check.
 */
export type HealthCheckResult = {
  /** Name of the health check */
  name: string;
  /** Status of the check: "ok" if passed, "failed" if not */
  status: "ok" | "failed";
  /** Error message if the check failed with an error */
  error?: string;
  /** Time in milliseconds the check took to execute */
  latencyMs: number;
};

/**
 * Aggregated health response for a service.
 */
export type HealthResponse = {
  /** Overall status: "healthy" if all pass, "unhealthy" if all fail, "degraded" if mixed */
  status: "healthy" | "unhealthy" | "degraded";
  /** Name of the service */
  service: string;
  /** ISO timestamp of when the health check was performed */
  timestamp: string;
  /** Individual health check results */
  checks: HealthCheckResult[];
};

/**
 * Runs a single health check and returns the result.
 *
 * @param name - Name to identify this health check
 * @param check - The health check function to run
 * @returns A HealthCheckResult with status, latency, and optional error
 *
 * @example
 * ```typescript
 * const result = await runHealthCheck("database", async () => {
 *   const connected = await db.ping();
 *   return Result.ok(connected);
 * });
 *
 * if (result.status === "ok") {
 *   console.log(`Database check passed in ${result.latencyMs}ms`);
 * }
 * ```
 */
export async function runHealthCheck(
  name: string,
  check: HealthCheckFn,
): Promise<HealthCheckResult> {
  const start = performance.now();
  const result = await check();
  const latencyMs = performance.now() - start;

  if (result.isErr()) {
    return { name, status: "failed", error: result.error.message, latencyMs };
  }

  // Use take() to extract the value after confirming it's not an error
  const value = result.take();
  return { name, status: value ? "ok" : "failed", latencyMs };
}

/**
 * Runs all health checks and returns an aggregated health response.
 *
 * @param service - Name of the service being checked
 * @param checks - Record of check names to check functions
 * @returns A HealthResponse with overall status and individual check results
 *
 * @example
 * ```typescript
 * const health = await runAllHealthChecks("api-service", {
 *   database: async () => Result.ok(await db.ping()),
 *   cache: async () => Result.ok(await redis.ping()),
 *   queue: async () => Result.ok(await rabbit.ping()),
 * });
 *
 * if (health.status === "healthy") {
 *   console.log("All systems operational");
 * } else if (health.status === "degraded") {
 *   console.warn("Some systems are failing");
 * } else {
 *   console.error("Service is unhealthy");
 * }
 * ```
 */
export async function runAllHealthChecks(
  service: string,
  checks: Record<string, HealthCheckFn>,
): Promise<HealthResponse> {
  const results = await Promise.all(
    Object.entries(checks).map(([name, fn]) => runHealthCheck(name, fn)),
  );

  const allOk = results.every((r) => r.status === "ok");
  const anyOk = results.some((r) => r.status === "ok");

  return {
    status: allOk ? "healthy" : anyOk ? "degraded" : "unhealthy",
    service,
    timestamp: new Date().toISOString(),
    checks: results,
  };
}
