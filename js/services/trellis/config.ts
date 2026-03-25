import { env } from "node:process";
import { z } from "zod";

const oAuthProviderSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
});

const CANONICAL_LOOPBACK_HOST = "localhost";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function canonicalizeLoopbackUrl(value: string | undefined): string | undefined {
  if (!value) return value;
  try {
    const url = new URL(value);
    if (LOOPBACK_HOSTS.has(url.hostname)) {
      url.hostname = CANONICAL_LOOPBACK_HOST;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
}

const schema = z
  .object({
    serviceName: z.string().default("trellis"),
    logLevel: z.string().default("info"),
    port: z.coerce.number().default(3000),
    sessionKeySeed: z.string(),
    web: z.object({
      origins: z.array(z.string()).default([]),
      publicOrigin: z.string().optional(),
    }),
    httpRateLimit: z.object({
      windowMs: z.coerce.number().default(60_000),
      max: z.coerce.number().default(60),
    }).readonly(),
    ttlMs: z.object({
      sessions: z.coerce.number().default(24 * 60 * 60_000),
      oauth: z.coerce.number().default(5 * 60_000),
      pendingAuth: z.coerce.number().default(5 * 60_000),
      bindingTokens: z.object({
        bucket: z.coerce.number().default(2 * 60 * 60_000),
        initial: z.coerce.number().default(5 * 60_000),
        renew: z.coerce.number().default(60 * 60_000),
      }).readonly(),
      connections: z.coerce.number().default(2 * 60 * 60_000),
      natsJwt: z.coerce.number().default(60 * 60_000),
    })
      .readonly()
      .superRefine((ttl: {
        bindingTokens: { bucket: number; initial: number; renew: number };
      }, ctx: z.RefinementCtx) => {
        const requiredMin = Math.max(
          ttl.bindingTokens.initial,
          ttl.bindingTokens.renew,
        );
        if (ttl.bindingTokens.bucket < requiredMin) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "AUTH_TTL_BINDING_TOKENS_BUCKET must be >= initial and renew TTLs",
            path: ["bindingTokens", "bucket"],
          });
        }
      }),
    nats: z.object({
      servers: z.string(),
      trellis: z.object({
        credsPath: z.string(),
      }),
      auth: z.object({
        credsPath: z.string(),
      }),
      sentinelCredsPath: z.string(),
      authCallout: z.object({
        issuer: z.object({
          nkey: z.string(),
          signing: z.string(),
        }),
        target: z.object({
          nkey: z.string(),
          signing: z.string(),
        }),
        sxSeed: z.string(),
      }),
    }),
    oauth: z.object({
      redirect: z.string(),
      providers: z.object({
        github: oAuthProviderSchema,
      }),
    }),
  })
  .readonly();

export type Config = z.infer<typeof schema>;

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function parseAuthConfigFromEnv(
  env: Record<string, string | undefined>,
): Config {
  return schema.parse({
    serviceName: env["SERVICE_NAME"],
    logLevel: env["LOG_LEVEL"],
    port: env["AUTH_PORT"],
    sessionKeySeed: env["TRELLIS_SESSION_KEY_SEED"],
    web: {
      origins: parseCsv(env["AUTH_WEB_ORIGINS"]).map((origin) => canonicalizeLoopbackUrl(origin) ?? origin),
      publicOrigin: canonicalizeLoopbackUrl(env["AUTH_PUBLIC_ORIGIN"]),
    },
    httpRateLimit: {
      windowMs: env["AUTH_HTTP_RATE_LIMIT_WINDOW_MS"],
      max: env["AUTH_HTTP_RATE_LIMIT_MAX"],
    },
    ttlMs: {
      sessions: env["AUTH_TTL_SESSIONS"],
      oauth: env["AUTH_TTL_OAUTH"],
      pendingAuth: env["AUTH_TTL_PENDING_AUTH"],
      bindingTokens: {
        bucket: env["AUTH_TTL_BINDING_TOKENS_BUCKET"],
        initial: env["AUTH_TTL_BINDING_TOKENS_INITIAL"],
        renew: env["AUTH_TTL_BINDING_TOKENS_RENEW"],
      },
      connections: env["AUTH_TTL_CONNECTIONS"],
      natsJwt: env["AUTH_TTL_NATS_JWT"],
    },
    nats: {
      servers: env["NATS_SERVERS"],
      auth: {
        credsPath: env["NATS_AUTH_CREDS_FILE"],
      },
      trellis: {
        credsPath: env["NATS_TRELLIS_CREDS_FILE"],
      },
      sentinelCredsPath: env["NATS_SENTINEL_CREDS"],
      authCallout: {
        issuer: {
          nkey: env["NATS_AUTH_ISSUER_NKEY"],
          signing: env["NATS_AUTH_ISSUER_SIGNING_SEED"],
        },
        target: {
          nkey: env["NATS_AUTH_TARGET_NKEY"],
          signing: env["NATS_AUTH_TARGET_SIGNING_SEED"],
        },
        sxSeed: env["NATS_AUTH_SXKEY_SEED"],
      },
    },
    oauth: {
      redirect: canonicalizeLoopbackUrl(env["AUTH_REDIRECT"]),
      providers: {
        github: {
          clientId: env["GITHUB_CLIENT_ID"],
          clientSecret: env["GITHUB_CLIENT_SECRET"],
        },
      },
    },
  });
}

let cachedConfig: Config | undefined;

export function getConfig(): Config {
  if (cachedConfig) return cachedConfig;
  cachedConfig = parseAuthConfigFromEnv(env);
  return cachedConfig;
}

export const __testing__ = {
  resetConfig() {
    cachedConfig = undefined;
  },
  setConfig(config: Config) {
    cachedConfig = config;
  },
};
