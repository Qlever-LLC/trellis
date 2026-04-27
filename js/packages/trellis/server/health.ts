/**
 * Health check types and utility functions for Trellis services.
 *
 * This module provides a standardized way to implement health checks
 * for services, with support for individual check results and
 * aggregated health status (healthy, degraded, unhealthy).
 *
 * @module
 */

import { type Result } from "@qlever-llc/result";
import type { JsonValue } from "@qlever-llc/trellis/contracts";
import { type TrellisError } from "@qlever-llc/trellis";

type MaybePromise<T> = T | Promise<T>;

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
  /** Optional short human-readable summary */
  summary?: string;
  /** Optional structured metadata for the check */
  info?: Record<string, JsonValue>;
  /** Time in milliseconds the check took to execute */
  latencyMs: number;
};

export type ServiceHealthInfo = {
  version?: string;
  info?: Record<string, JsonValue>;
};

export type ServiceHealthCheck = {
  status: "ok" | "failed";
  summary?: string;
  info?: Record<string, JsonValue>;
  error?: string;
};

export type ServiceHealthCheckFn = () => MaybePromise<ServiceHealthCheck>;
export type ServiceHealthInfoFn = () => MaybePromise<
  ServiceHealthInfo | undefined
>;

export type HealthHeartbeat = {
  header: {
    id: string;
    time: string;
  };
  service: {
    name: string;
    kind: "service" | "device";
    instanceId: string;
    contractId: string;
    contractDigest: string;
    startedAt: string;
    publishIntervalMs: number;
    runtime: "deno" | "node" | "rust" | "unknown";
    runtimeVersion?: string;
    version?: string;
    info?: Record<string, JsonValue>;
  };
  status: HealthResponse["status"];
  summary?: string;
  checks: HealthCheckResult[];
};

function summarizeHealthStatus(
  results: readonly Pick<HealthCheckResult, "status">[],
): HealthResponse["status"] {
  const allOk = results.every((r) => r.status === "ok");
  const anyOk = results.some((r) => r.status === "ok");
  return allOk ? "healthy" : anyOk ? "degraded" : "unhealthy";
}

function summarizeHealthChecks(
  results: readonly HealthCheckResult[],
): string | undefined {
  const failedCount = results.filter((r) => r.status === "failed").length;
  if (failedCount === 0) {
    return undefined;
  }

  return `${failedCount} check${failedCount === 1 ? "" : "s"} failing`;
}

function normalizeLegacyHealthCheck(
  check: HealthCheckFn,
): ServiceHealthCheckFn {
  return async () => {
    const result = await check();
    if (result.isErr()) {
      return {
        status: "failed",
        error: result.error.message,
        summary: result.error.message,
      };
    }

    return { status: result.take() ? "ok" : "failed" };
  };
}

function detectRuntime(): {
  runtime: HealthHeartbeat["service"]["runtime"];
  runtimeVersion?: string;
} {
  const maybeDeno = Reflect.get(globalThis, "Deno") as
    | { version?: { deno?: string } }
    | undefined;
  if (maybeDeno?.version?.deno) {
    return { runtime: "deno", runtimeVersion: maybeDeno.version.deno };
  }

  const maybeProcess = Reflect.get(globalThis, "process") as
    | { version?: string }
    | undefined;
  if (typeof maybeProcess?.version === "string") {
    return { runtime: "node", runtimeVersion: maybeProcess.version };
  }

  return { runtime: "unknown" };
}

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
  return await runServiceHealthCheck(name, normalizeLegacyHealthCheck(check));
}

export async function runServiceHealthCheck(
  name: string,
  check: ServiceHealthCheckFn,
): Promise<HealthCheckResult> {
  const start = performance.now();
  try {
    const result = await check();
    const latencyMs = performance.now() - start;
    return {
      name,
      status: result.status,
      error: result.error,
      summary: result.summary,
      info: result.info,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = performance.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    return {
      name,
      status: "failed",
      error: message,
      summary: message,
      latencyMs,
    };
  }
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
  const normalizedChecks = Object.fromEntries(
    Object.entries(checks).map((
      [name, check],
    ) => [name, normalizeLegacyHealthCheck(check)]),
  );
  return await runAllServiceHealthChecks(service, normalizedChecks);
}

export async function runAllServiceHealthChecks(
  service: string,
  checks: Record<string, ServiceHealthCheckFn>,
): Promise<HealthResponse> {
  const results = await Promise.all(
    Object.entries(checks).map(([name, fn]) => runServiceHealthCheck(name, fn)),
  );

  return {
    status: summarizeHealthStatus(results),
    service,
    timestamp: new Date().toISOString(),
    checks: results,
  };
}

export function createHealthHeartbeat(args: {
  serviceName: string;
  kind?: HealthHeartbeat["service"]["kind"];
  instanceId: string;
  contractId: string;
  contractDigest: string;
  startedAt: string;
  publishIntervalMs: number;
  checks: HealthCheckResult[];
  info?: ServiceHealthInfo;
}): Omit<HealthHeartbeat, "header"> {
  const runtime = detectRuntime();
  const summary = summarizeHealthChecks(args.checks);

  return {
    service: {
      name: args.serviceName,
      kind: args.kind ?? "service",
      instanceId: args.instanceId,
      contractId: args.contractId,
      contractDigest: args.contractDigest,
      startedAt: args.startedAt,
      publishIntervalMs: args.publishIntervalMs,
      runtime: runtime.runtime,
      ...(runtime.runtimeVersion
        ? { runtimeVersion: runtime.runtimeVersion }
        : {}),
      ...(args.info?.version ? { version: args.info.version } : {}),
      ...(args.info?.info ? { info: args.info.info } : {}),
    },
    status: summarizeHealthStatus(args.checks),
    ...(summary ? { summary } : {}),
    checks: args.checks,
  };
}

export class ServiceHealth {
  readonly serviceName: string;
  readonly kind: HealthHeartbeat["service"]["kind"];
  readonly instanceId: string;
  readonly contractId: string;
  readonly contractDigest: string;
  readonly startedAt: string;
  readonly publishIntervalMs: number;

  #checks = new Map<string, ServiceHealthCheckFn>();
  #info?: ServiceHealthInfoFn;

  constructor(args: {
    serviceName: string;
    kind?: HealthHeartbeat["service"]["kind"];
    instanceId?: string;
    contractId: string;
    contractDigest: string;
    publishIntervalMs: number;
    checks?: Record<string, HealthCheckFn>;
  }) {
    this.serviceName = args.serviceName;
    this.kind = args.kind ?? "service";
    this.instanceId = args.instanceId ?? crypto.randomUUID();
    this.contractId = args.contractId;
    this.contractDigest = args.contractDigest;
    this.startedAt = new Date().toISOString();
    this.publishIntervalMs = args.publishIntervalMs;

    for (const [name, check] of Object.entries(args.checks ?? {})) {
      this.#checks.set(name, normalizeLegacyHealthCheck(check));
    }
  }

  setInfo(info: ServiceHealthInfo | ServiceHealthInfoFn): void {
    if (typeof info === "function") {
      this.#info = info;
      return;
    }

    this.#info = () => info;
  }

  add(name: string, check: ServiceHealthCheckFn): () => void {
    this.#checks.set(name, check);
    return () => {
      this.#checks.delete(name);
    };
  }

  async checks(): Promise<HealthCheckResult[]> {
    return await Promise.all(
      Array.from(this.#checks.entries()).map(([name, check]) =>
        runServiceHealthCheck(name, check)
      ),
    );
  }

  async response(): Promise<HealthResponse> {
    const checks = Object.fromEntries(this.#checks.entries());
    return await runAllServiceHealthChecks(this.serviceName, checks);
  }

  async heartbeat(): Promise<Omit<HealthHeartbeat, "header">> {
    const checks = await this.checks();
    const info = this.#info ? await this.#info() : undefined;
    return createHealthHeartbeat({
      serviceName: this.serviceName,
      kind: this.kind,
      instanceId: this.instanceId,
      contractId: this.contractId,
      contractDigest: this.contractDigest,
      startedAt: this.startedAt,
      publishIntervalMs: this.publishIntervalMs,
      checks,
      info,
    });
  }
}
