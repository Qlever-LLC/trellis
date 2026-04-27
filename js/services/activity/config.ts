import { Type } from "typebox";
import { Value } from "typebox/value";

export type ActivityConfig = Readonly<{
  serviceName: string;
  trellisUrl: string;
  sessionKeySeed: string;
  bootstrap: {
    pollMs: number;
    timeoutMs: number;
  };
}>;

const ActivityConfigSchema = Type.Object({
  serviceName: Type.String({ minLength: 1 }),
  trellisUrl: Type.String({ minLength: 1 }),
  sessionKeySeed: Type.String({ minLength: 1 }),
  bootstrap: Type.Object({
    pollMs: Type.Integer({ minimum: 1 }),
    timeoutMs: Type.Integer({ minimum: 1 }),
  }),
});

function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseNumberEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name)?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid numeric environment variable: ${name}`);
  }
  return value;
}

export function getConfig(): ActivityConfig {
  return Value.Parse(ActivityConfigSchema, {
    serviceName: Deno.env.get("ACTIVITY_SERVICE_NAME")?.trim() || "activity",
    trellisUrl: requireEnv("TRELLIS_URL"),
    sessionKeySeed: requireEnv("ACTIVITY_SESSION_KEY_SEED"),
    bootstrap: {
      pollMs: parseNumberEnv("ACTIVITY_BOOTSTRAP_POLL_MS", 4000),
      timeoutMs: parseNumberEnv(
        "ACTIVITY_BOOTSTRAP_TIMEOUT_MS",
        15 * 60 * 1000,
      ),
    },
  }) as ActivityConfig;
}
