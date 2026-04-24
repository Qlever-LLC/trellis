import { env } from "node:process";
import { parse as parseJsonc } from "npm:jsonc-parser@^3.3.1";
import { dirname, isAbsolute, join, normalize } from "@std/path";
import { z } from "zod";

const DEFAULT_TRELLIS_CONFIG_PATH = "/etc/trellis/config.jsonc";
const CANONICAL_LOOPBACK_HOST = "localhost";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const githubProviderSchema = z.object({
  type: z.literal("github"),
  clientId: z.string(),
  clientSecret: z.string().optional(),
  clientSecretFile: z.string().optional(),
  displayName: z.string().optional(),
});

const oidcProviderSchema = z.object({
  type: z.literal("oidc"),
  issuer: z.string().url(),
  clientId: z.string(),
  clientSecret: z.string().optional(),
  clientSecretFile: z.string().optional(),
  displayName: z.string().optional(),
  scopes: z.array(z.string()).default(["openid", "profile", "email"]),
});

const httpRateLimitSchema = z.object({
  windowMs: z.coerce.number().default(60_000),
  max: z.coerce.number().default(60),
});

const ttlSchema = z.object({
  sessions: z.coerce.number().default(24 * 60 * 60_000),
  oauth: z.coerce.number().default(5 * 60_000),
  deviceFlow: z.coerce.number().default(30 * 60_000),
  pendingAuth: z.coerce.number().default(5 * 60_000),
  connections: z.coerce.number().default(2 * 60 * 60_000),
  natsJwt: z.coerce.number().default(60 * 60_000),
});

const rawSchema = z.object({
  logLevel: z.string().default("info"),
  port: z.coerce.number().default(3000),
  instanceName: z.string().default("Trellis Auth"),
  web: z
    .object({
      origins: z.array(z.string()).default(["*"]),
      publicOrigin: z.string().optional(),
      allowInsecureOrigins: z.array(z.string()).default([]),
    })
    .default({
      origins: ["*"],
      allowInsecureOrigins: [],
    }),
  httpRateLimit: httpRateLimitSchema.default({
    windowMs: 60_000,
    max: 60,
  }),
  ttlMs: ttlSchema.default({
    sessions: 24 * 60 * 60_000,
    oauth: 5 * 60_000,
    deviceFlow: 30 * 60_000,
    pendingAuth: 5 * 60_000,
    connections: 2 * 60 * 60_000,
    natsJwt: 60 * 60_000,
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
        signing: z.string().optional(),
        signingSeedFile: z.string().optional(),
      }),
      target: z.object({
        nkey: z.string(),
        signing: z.string().optional(),
        signingSeedFile: z.string().optional(),
      }),
      sxSeed: z.string().optional(),
      sxSeedFile: z.string().optional(),
    }),
  }),
  sessionKeySeed: z.string().optional(),
  sessionKeySeedFile: z.string().optional(),
  client: z.object({
    natsServers: z.array(z.string()).min(1),
    nativeNatsServers: z.array(z.string()).min(1).optional(),
  }),
  oauth: z.object({
    redirectBase: z.string(),
    alwaysShowProviderChooser: z.boolean().default(false),
    providers: z
      .record(
        z.string().min(1),
        z.discriminatedUnion("type", [
          githubProviderSchema,
          oidcProviderSchema,
        ]),
      )
      .refine(
        (providers: unknown) =>
          Object.keys(providers as Record<string, unknown>).length > 0,
        "At least one auth provider must be configured",
      ),
  }),
});

export type GitHubProviderConfig = {
  type: "github";
  clientId: string;
  clientSecret: string;
  displayName: string;
};

export type OIDCProviderConfig = {
  type: "oidc";
  issuer: string;
  clientId: string;
  clientSecret: string;
  displayName: string;
  scopes: string[];
};

export type AuthProviderConfig = GitHubProviderConfig | OIDCProviderConfig;

export type Config = {
  logLevel: string;
  port: number;
  instanceName: string;
  web: {
    origins: string[];
    publicOrigin?: string;
    allowInsecureOrigins: string[];
  };
  httpRateLimit: {
    windowMs: number;
    max: number;
  };
  ttlMs: {
    sessions: number;
    oauth: number;
    deviceFlow: number;
    pendingAuth: number;
    connections: number;
    natsJwt: number;
  };
  nats: {
    servers: string;
    trellis: { credsPath: string };
    auth: { credsPath: string };
    sentinelCredsPath: string;
    authCallout: {
      issuer: { nkey: string; signing: string };
      target: { nkey: string; signing: string };
      sxSeed: string;
    };
  };
  sessionKeySeed: string;
  client: {
    natsServers: string[];
    nativeNatsServers?: string[];
  };
  oauth: {
    redirectBase: string;
    alwaysShowProviderChooser: boolean;
    providers: Record<string, AuthProviderConfig>;
  };
};

type RawConfig = z.infer<typeof rawSchema>;

function canonicalizeLoopbackUrl(
  value: string | undefined,
): string | undefined {
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

function normalizeOriginList(origins: string[]): string[] {
  const normalized: string[] = [];
  for (const origin of origins) {
    const canonicalOrigin = canonicalizeLoopbackUrl(origin) ?? origin;
    if (!normalized.includes(canonicalOrigin)) {
      normalized.push(canonicalOrigin);
    }
  }
  return normalized;
}

function normalizeWebOrigins(origins: string[]): string[] {
  if (origins.includes("*")) return ["*"];
  return normalizeOriginList(origins);
}

function resolvePath(configPath: string, targetPath: string): string {
  if (isAbsolute(targetPath)) return normalize(targetPath);
  return normalize(join(dirname(configPath), targetPath));
}

function readConfiguredValue(
  configPath: string,
  label: string,
  inlineValue: string | undefined,
  fileValue: string | undefined,
): string {
  if (inlineValue && fileValue) {
    throw new Error(
      `${label} must specify either an inline value or a file, not both`,
    );
  }
  if (inlineValue) return inlineValue.trim();
  if (fileValue) {
    return Deno.readTextFileSync(resolvePath(configPath, fileValue)).trim();
  }
  throw new Error(`${label} is required`);
}

function resolveProviderConfig(
  configPath: string,
  key: string,
  provider: RawConfig["oauth"]["providers"][string],
): AuthProviderConfig {
  const clientSecret = readConfiguredValue(
    configPath,
    `oauth.providers.${key}.clientSecret`,
    provider.clientSecret,
    provider.clientSecretFile,
  );

  if (provider.type === "github") {
    return {
      type: "github",
      clientId: provider.clientId,
      clientSecret,
      displayName: provider.displayName ?? "GitHub",
    };
  }

  return {
    type: "oidc",
    issuer: provider.issuer,
    clientId: provider.clientId,
    clientSecret,
    displayName: provider.displayName ?? key,
    scopes: provider.scopes,
  };
}

function normalizeConfig(configPath: string, raw: RawConfig): Config {
  const providers = Object.fromEntries(
    Object.entries(raw.oauth.providers).map(([key, provider]) => [
      key,
      resolveProviderConfig(configPath, key, provider),
    ]),
  );

  return {
    logLevel: raw.logLevel,
    port: raw.port,
    instanceName: raw.instanceName,
    web: {
      origins: normalizeWebOrigins(raw.web.origins),
      publicOrigin: canonicalizeLoopbackUrl(raw.web.publicOrigin),
      allowInsecureOrigins: normalizeOriginList(raw.web.allowInsecureOrigins),
    },
    httpRateLimit: raw.httpRateLimit,
    ttlMs: raw.ttlMs,
    nats: {
      servers: raw.nats.servers,
      trellis: raw.nats.trellis,
      auth: raw.nats.auth,
      sentinelCredsPath: raw.nats.sentinelCredsPath,
      authCallout: {
        issuer: {
          nkey: raw.nats.authCallout.issuer.nkey,
          signing: readConfiguredValue(
            configPath,
            "nats.authCallout.issuer.signing",
            raw.nats.authCallout.issuer.signing,
            raw.nats.authCallout.issuer.signingSeedFile,
          ),
        },
        target: {
          nkey: raw.nats.authCallout.target.nkey,
          signing: readConfiguredValue(
            configPath,
            "nats.authCallout.target.signing",
            raw.nats.authCallout.target.signing,
            raw.nats.authCallout.target.signingSeedFile,
          ),
        },
        sxSeed: readConfiguredValue(
          configPath,
          "nats.authCallout.sxSeed",
          raw.nats.authCallout.sxSeed,
          raw.nats.authCallout.sxSeedFile,
        ),
      },
    },
    sessionKeySeed: readConfiguredValue(
      configPath,
      "sessionKeySeed",
      raw.sessionKeySeed,
      raw.sessionKeySeedFile,
    ),
    client: {
      natsServers: raw.client.natsServers,
      nativeNatsServers: raw.client.nativeNatsServers,
    },
    oauth: {
      redirectBase:
        canonicalizeLoopbackUrl(raw.oauth.redirectBase) ??
        raw.oauth.redirectBase,
      alwaysShowProviderChooser: raw.oauth.alwaysShowProviderChooser,
      providers,
    },
  };
}

function parseAuthConfig(configPath: string, text: string): Config {
  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const parsed = parseJsonc(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
    allowEmptyContent: false,
  });
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(
      `Invalid JSONC in ${configPath} at offset ${first?.offset ?? 0}`,
    );
  }
  const raw = rawSchema.parse(parsed);
  return normalizeConfig(configPath, raw);
}

export async function loadAuthConfigFromFile(
  configPath: string,
): Promise<Config> {
  return loadAuthConfigFromFileSync(configPath);
}

export function loadAuthConfigFromFileSync(configPath: string): Config {
  return parseAuthConfig(configPath, Deno.readTextFileSync(configPath));
}

function resolveConfigPath(
  environment: Record<string, string | undefined>,
): string {
  return (
    environment["TRELLIS_CONFIG"] ??
    environment["TRELLIS_AUTH_CONFIG"] ??
    DEFAULT_TRELLIS_CONFIG_PATH
  );
}

let cachedConfig: Config | undefined;

export function getConfig(): Config {
  if (cachedConfig) return cachedConfig;
  cachedConfig = loadAuthConfigFromFileSync(resolveConfigPath(env));
  return cachedConfig;
}

export const __testing__ = {
  resetConfig() {
    cachedConfig = undefined;
  },
  setConfig(config: Config) {
    cachedConfig = config;
  },
  parseAuthConfig,
  resolveConfigPath,
};
