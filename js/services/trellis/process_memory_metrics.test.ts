import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { assertEquals } from "@std/assert";

import { registerProcessMemoryMetrics } from "./process_memory_metrics.ts";

Deno.test("process memory gauges expose RSS heap and external bytes", async () => {
  const exporter = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  );
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 60_000,
  });
  const provider = new MeterProvider({ readers: [reader] });
  metrics.disable();
  metrics.setGlobalMeterProvider(provider);

  registerProcessMemoryMetrics(() => ({
    rss: 101,
    heapTotal: 202,
    heapUsed: 303,
    external: 404,
  }));
  await provider.forceFlush();

  const points = exporter.getMetrics().flatMap((resource) =>
    resource.scopeMetrics.flatMap((scope) =>
      scope.metrics.flatMap((metric) =>
        metric.dataPoints.map((point) => ({
          name: metric.descriptor.name,
          unit: metric.descriptor.unit,
          kind: point.attributes["trellis.memory.kind"],
          value: point.value,
        }))
      )
    )
  ).sort((left, right) => String(left.kind).localeCompare(String(right.kind)));

  assertEquals(points, [
    {
      name: "trellis.process.memory.usage",
      unit: "By",
      kind: "external",
      value: 404,
    },
    {
      name: "trellis.process.memory.usage",
      unit: "By",
      kind: "heap_total",
      value: 202,
    },
    {
      name: "trellis.process.memory.usage",
      unit: "By",
      kind: "heap_used",
      value: 303,
    },
    {
      name: "trellis.process.memory.usage",
      unit: "By",
      kind: "rss",
      value: 101,
    },
  ]);

  await provider.shutdown();
  metrics.disable();
});
