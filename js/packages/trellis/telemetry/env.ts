type DenoLike = {
  env?: {
    get(key: string): string | undefined;
  };
};

type ProcessLike = {
  env?: Record<string, string | undefined>;
};

type EnvironmentGlobalThis = typeof globalThis & {
  Deno?: DenoLike;
  process?: ProcessLike;
};

// Shared telemetry code needs environment access without assuming Deno or Node.
export function getEnv(key: string): string | undefined {
  const environmentGlobal = globalThis as EnvironmentGlobalThis;
  if (environmentGlobal.Deno?.env?.get) {
    try {
      return environmentGlobal.Deno.env.get(key);
    } catch {
      return undefined;
    }
  }

  return environmentGlobal.process?.env?.[key];
}
