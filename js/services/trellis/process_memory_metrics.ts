import { getTrellisMeter } from "@qlever-llc/trellis/telemetry";

type ProcessMemoryUsage = ReturnType<typeof Deno.memoryUsage>;

/** Registers process memory gauges that include native and external allocations. */
export function registerProcessMemoryMetrics(
  memoryUsage: () => ProcessMemoryUsage = Deno.memoryUsage,
): void {
  const usage = getTrellisMeter().createObservableGauge(
    "trellis.process.memory.usage",
    {
      description:
        "Current Trellis process memory by Deno memory accounting category.",
      unit: "By",
    },
  );

  usage.addCallback((result) => {
    const sample = memoryUsage();
    result.observe(sample.rss, { "trellis.memory.kind": "rss" });
    result.observe(sample.heapUsed, { "trellis.memory.kind": "heap_used" });
    result.observe(sample.heapTotal, { "trellis.memory.kind": "heap_total" });
    result.observe(sample.external, { "trellis.memory.kind": "external" });
  });
}
