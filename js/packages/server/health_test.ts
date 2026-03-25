/**
 * Tests for health check types and utility functions.
 *
 * These tests verify:
 * - runHealthCheck returns HealthCheckResult with correct shape
 * - runHealthCheck calculates latencyMs
 * - runHealthCheck returns status "ok" when check succeeds
 * - runHealthCheck returns status "failed" with error message when check fails
 * - runAllHealthChecks returns "healthy" when all checks pass
 * - runAllHealthChecks returns "unhealthy" when all checks fail
 * - runAllHealthChecks returns "degraded" when some checks pass
 */

import { assert, assertEquals } from "@std/assert";
import { Result } from "@trellis/result";
import { TrellisError } from "@trellis/trellis";
import {
  type HealthCheckFn,
  type HealthCheckResult,
  runAllHealthChecks,
  runHealthCheck,
} from "./health.ts";

/**
 * A simple TrellisError subclass for testing.
 */
class TestError extends TrellisError {
  override readonly name = "TestError" as const;

  constructor(message: string) {
    super(message);
  }

  override toSerializable() {
    return this.baseSerializable();
  }
}

/**
 * Helper to create a successful health check function.
 */
function successCheck(): HealthCheckFn {
  return async () => {
    return Result.ok(true);
  };
}

/**
 * Helper to create a failing health check function.
 */
function failCheck(message: string): HealthCheckFn {
  return async () => {
    return Result.err(new TestError(message));
  };
}

/**
 * Helper to create a health check that returns false (considered failed).
 */
function falseCheck(): HealthCheckFn {
  return async () => {
    return Result.ok(false);
  };
}

/**
 * Helper to create a slow health check for latency testing.
 */
function slowCheck(delayMs: number): HealthCheckFn {
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return Result.ok(true);
  };
}

Deno.test("runHealthCheck", async (t) => {
  await t.step("returns HealthCheckResult with correct shape", async () => {
    const result = await runHealthCheck("test-check", successCheck());

    assert(result.name !== undefined, "name should be defined");
    assert(result.status !== undefined, "status should be defined");
    assert(result.latencyMs !== undefined, "latencyMs should be defined");
    assertEquals(typeof result.name, "string");
    assertEquals(typeof result.status, "string");
    assertEquals(typeof result.latencyMs, "number");
  });

  await t.step("includes the name in the result", async () => {
    const result = await runHealthCheck("my-database", successCheck());

    assertEquals(result.name, "my-database");
  });

  await t.step("calculates latencyMs", async () => {
    const delayMs = 50;
    const result = await runHealthCheck("slow-check", slowCheck(delayMs));

    // Latency should be at least the delay amount (with some tolerance)
    assert(
      result.latencyMs >= delayMs,
      `Expected latency >= ${delayMs}ms, got ${result.latencyMs}ms`,
    );
    // But not too much more (give reasonable upper bound)
    assert(
      result.latencyMs < delayMs + 100,
      `Expected latency < ${delayMs + 100}ms, got ${result.latencyMs}ms`,
    );
  });

  await t.step("returns status 'ok' when check succeeds with true", async () => {
    const result = await runHealthCheck("healthy-service", successCheck());

    assertEquals(result.status, "ok");
    assertEquals(result.error, undefined);
  });

  await t.step("returns status 'failed' when check returns false", async () => {
    const result = await runHealthCheck("unhealthy-service", falseCheck());

    assertEquals(result.status, "failed");
  });

  await t.step("returns status 'failed' with error message when check fails", async () => {
    const errorMessage = "Connection refused";
    const result = await runHealthCheck(
      "broken-service",
      failCheck(errorMessage),
    );

    assertEquals(result.status, "failed");
    assertEquals(result.error, errorMessage);
  });
});

Deno.test("runAllHealthChecks", async (t) => {
  await t.step("returns HealthResponse with correct shape", async () => {
    const response = await runAllHealthChecks("test-service", {
      db: successCheck(),
    });

    assert(response.status !== undefined, "status should be defined");
    assert(response.service !== undefined, "service should be defined");
    assert(response.timestamp !== undefined, "timestamp should be defined");
    assert(response.checks !== undefined, "checks should be defined");
    assertEquals(typeof response.status, "string");
    assertEquals(typeof response.service, "string");
    assertEquals(typeof response.timestamp, "string");
    assert(Array.isArray(response.checks), "checks should be an array");
  });

  await t.step("includes the service name in the response", async () => {
    const response = await runAllHealthChecks("my-api-service", {
      db: successCheck(),
    });

    assertEquals(response.service, "my-api-service");
  });

  await t.step("includes a valid ISO timestamp", async () => {
    const response = await runAllHealthChecks("test-service", {
      db: successCheck(),
    });

    // Should be a valid ISO date string
    const date = new Date(response.timestamp);
    assert(!isNaN(date.getTime()), "timestamp should be a valid date");
  });

  await t.step("returns 'healthy' when all checks pass", async () => {
    const response = await runAllHealthChecks("healthy-service", {
      database: successCheck(),
      cache: successCheck(),
      queue: successCheck(),
    });

    assertEquals(response.status, "healthy");
    assertEquals(response.checks.length, 3);
    assert(
      response.checks.every((c: HealthCheckResult) => c.status === "ok"),
      "all checks should be ok",
    );
  });

  await t.step("returns 'unhealthy' when all checks fail", async () => {
    const response = await runAllHealthChecks("broken-service", {
      database: failCheck("DB down"),
      cache: failCheck("Cache unreachable"),
      queue: failCheck("Queue timeout"),
    });

    assertEquals(response.status, "unhealthy");
    assertEquals(response.checks.length, 3);
    assert(
      response.checks.every((c: HealthCheckResult) => c.status === "failed"),
      "all checks should be failed",
    );
  });

  await t.step("returns 'degraded' when some checks pass and some fail", async () => {
    const response = await runAllHealthChecks("partial-service", {
      database: successCheck(),
      cache: failCheck("Cache unreachable"),
      queue: successCheck(),
    });

    assertEquals(response.status, "degraded");
    assertEquals(response.checks.length, 3);

    const okCount = response.checks.filter(
      (c: HealthCheckResult) => c.status === "ok",
    ).length;
    const failedCount = response.checks.filter(
      (c: HealthCheckResult) => c.status === "failed",
    ).length;
    assertEquals(okCount, 2);
    assertEquals(failedCount, 1);
  });

  await t.step("returns 'healthy' when there are no checks", async () => {
    const response = await runAllHealthChecks("empty-service", {});

    assertEquals(response.checks.length, 0);
    // With every() on empty array returning true, it should be "healthy"
    assertEquals(response.status, "healthy");
  });

  await t.step("includes individual check results with correct names", async () => {
    const response = await runAllHealthChecks("named-service", {
      "primary-db": successCheck(),
      "redis-cache": failCheck("Connection failed"),
    });

    const dbCheck = response.checks.find(
      (c: HealthCheckResult) => c.name === "primary-db",
    );
    const cacheCheck = response.checks.find(
      (c: HealthCheckResult) => c.name === "redis-cache",
    );

    assert(dbCheck !== undefined, "primary-db check should exist");
    assert(cacheCheck !== undefined, "redis-cache check should exist");
    assertEquals(dbCheck.status, "ok");
    assertEquals(cacheCheck.status, "failed");
    assertEquals(cacheCheck.error, "Connection failed");
  });
});
