type DenoLike = {
  env?: {
    get(key: string): string | undefined;
  };
};

type ProcessLike = {
  env?: Record<string, string | undefined>;
};

// Shared telemetry code needs environment access without assuming Deno or Node.
export function getEnv(key: string): string | undefined {
  const deno = globalThis as typeof globalThis & { Deno?: DenoLike };
  if (deno.Deno?.env?.get) {
    return deno.Deno.env.get(key);
  }

  const processGlobal = globalThis as typeof globalThis & { process?: ProcessLike };
  return processGlobal.process?.env?.[key];
}
