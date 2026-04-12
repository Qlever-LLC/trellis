import { getEnv } from "./env.ts";

let initialized = false;
let provider: { register(): void } | undefined;

type TracingRuntimeModules = {
  NodeTracerProvider: typeof import("@opentelemetry/sdk-trace-node").NodeTracerProvider;
  OTLPTraceExporter: typeof import("@opentelemetry/exporter-trace-otlp-http").OTLPTraceExporter;
  BatchSpanProcessor: typeof import("@opentelemetry/sdk-trace-base").BatchSpanProcessor;
  ConsoleSpanExporter: typeof import("@opentelemetry/sdk-trace-base").ConsoleSpanExporter;
  Resource: typeof import("@opentelemetry/resources").Resource;
  ATTR_SERVICE_NAME: typeof import("@opentelemetry/semantic-conventions").ATTR_SERVICE_NAME;
};

function runtimeImport<TModule>(specifier: string): Promise<TModule> {
  const load = new Function("specifier", "return import(specifier);") as (
    specifier: string,
  ) => Promise<TModule>;
  return load(specifier);
}

async function loadTracingRuntime(): Promise<TracingRuntimeModules> {
  const [traceNode, otlp, traceBase, resources, semantic] = await Promise.all([
    runtimeImport<typeof import("@opentelemetry/sdk-trace-node")>(
      ["@opentelemetry", "sdk-trace-node"].join("/"),
    ),
    runtimeImport<typeof import("@opentelemetry/exporter-trace-otlp-http")>(
      ["@opentelemetry", "exporter-trace-otlp-http"].join("/"),
    ),
    runtimeImport<typeof import("@opentelemetry/sdk-trace-base")>(
      ["@opentelemetry", "sdk-trace-base"].join("/"),
    ),
    runtimeImport<typeof import("@opentelemetry/resources")>(
      ["@opentelemetry", "resources"].join("/"),
    ),
    runtimeImport<typeof import("@opentelemetry/semantic-conventions")>(
      ["@opentelemetry", "semantic-conventions"].join("/"),
    ),
  ]);

  return {
    NodeTracerProvider: traceNode.NodeTracerProvider,
    OTLPTraceExporter: otlp.OTLPTraceExporter,
    BatchSpanProcessor: traceBase.BatchSpanProcessor,
    ConsoleSpanExporter: traceBase.ConsoleSpanExporter,
    Resource: resources.Resource,
    ATTR_SERVICE_NAME: semantic.ATTR_SERVICE_NAME,
  };
}

async function initTracingRuntime(serviceName: string): Promise<void> {
  const endpoint = getEnv("OTEL_EXPORTER_OTLP_ENDPOINT");
  const consoleTracing = getEnv("OTEL_TRACES_CONSOLE") === "true";

  if (!endpoint && !consoleTracing) {
    return;
  }

  try {
    const runtime = await loadTracingRuntime();
    const spanProcessors: Array<InstanceType<typeof runtime.BatchSpanProcessor>> = [];

    if (endpoint) {
      spanProcessors.push(
        new runtime.BatchSpanProcessor(
          new runtime.OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
        ),
      );
    } else if (consoleTracing) {
      spanProcessors.push(
        new runtime.BatchSpanProcessor(new runtime.ConsoleSpanExporter()),
      );
    }

    provider = new runtime.NodeTracerProvider({
      resource: new runtime.Resource({
        [runtime.ATTR_SERVICE_NAME]: serviceName,
      }),
      ...(spanProcessors.length > 0 ? { spanProcessors } : {}),
    });

    provider.register();
  } catch (error) {
    console.warn("Failed to initialize tracing runtime", error);
  }
}

export function initTelemetry(serviceName: string): void {
  if (initialized) return;
  initialized = true;

  void initTracingRuntime(serviceName);
}
