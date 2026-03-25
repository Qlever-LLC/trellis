import { Type } from "typebox";
import { Value } from "typebox/value";

export type ActivityConfig = Readonly<{
  serviceName: string;
  sessionKeySeed: string;
  nats: {
    servers: string | string[];
    sentinelCredsPath: string;
  };
  bootstrap: {
    pollMs: number;
    timeoutMs: number;
  };
}>;

const ActivityConfigSchema = Type.Object({
  serviceName: Type.String({ minLength: 1 }),
  sessionKeySeed: Type.String({ minLength: 1 }),
  nats: Type.Object({
    servers: Type.Union([
      Type.String({ minLength: 1 }),
      Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    ]),
    sentinelCredsPath: Type.String({ minLength: 1 }),
  }),
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

function parseServers(value: string): string | string[] {
  const items = value.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length <= 1 ? (items[0] ?? "localhost") : items;
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
    sessionKeySeed: requireEnv("ACTIVITY_SESSION_KEY_SEED"),
    nats: {
      servers: parseServers(Deno.env.get("NATS_SERVERS")?.trim() || "localhost"),
      sentinelCredsPath: Deno.env.get("NATS_SENTINEL_CREDS")?.trim() || ".local/nats/sentinel.creds",
    },
    bootstrap: {
      pollMs: parseNumberEnv("ACTIVITY_BOOTSTRAP_POLL_MS", 4000),
      timeoutMs: parseNumberEnv("ACTIVITY_BOOTSTRAP_TIMEOUT_MS", 15 * 60 * 1000),
    },
  }) as ActivityConfig;
}
