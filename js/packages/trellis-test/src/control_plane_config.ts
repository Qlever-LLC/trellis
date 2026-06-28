import { dirname, join } from "@std/path";
import type { LocalNatsBootstrapManifest } from "./nats_bootstrap.ts";

/** @internal File-backed Trellis control-plane config used by test runtimes. */
export type TrellisControlPlaneConfig = {
  logLevel: string;
  port: number;
  instanceName: string;
  web: {
    origins: string[];
    publicOrigin: string;
    allowInsecureOrigins: string[];
  };
  httpRateLimit: {
    windowMs: number;
    max: number;
  };
  storage: {
    dbPath: string;
  };
  auth: {
    localIdentity: {
      enabled: boolean;
      passwordPolicy: {
        minLength: number;
      };
      passwordHashing: {
        profile: "default" | "insecure-test-fast";
      };
    };
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
    jetstream: {
      replicas: number;
    };
    system: { credsPath: string };
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
    nativeNatsServers: string[];
  };
  oauth: {
    redirectBase: string;
    alwaysShowProviderChooser: boolean;
    providers: Record<string, TrellisControlPlaneOAuthProvider>;
  };
  trellisTest: {
    failOnce: string[];
  };
};

/** Serializable OAuth/OIDC provider config for test control planes. */
export type TrellisControlPlaneOAuthProvider =
  | {
    type: "github";
    clientId: string;
    clientSecret?: string;
    displayName?: string;
  }
  | {
    type: "oidc";
    issuer: string;
    clientId: string;
    clientSecret?: string;
    displayName?: string;
    scopes?: string[];
    organization?: string;
    logout?: {
      enabled?: boolean;
      endpoint?: string;
      mode?: "oidc" | "auth0";
      allowFederated?: boolean;
    };
  };

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

/** Generates a random base64url seed for Trellis session-key material. */
export function generateSessionSeed(): string {
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  return base64url(seed);
}

/** Reserves a localhost TCP port for the spawned Trellis HTTP listener. */
export function reserveLocalPort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = listener.addr.port;
  listener.close();
  return port;
}

/** Builds the real Trellis control-plane config for an isolated test runtime. */
export function buildControlPlaneConfig(args: {
  workdir: string;
  natsUrl: string;
  websocketUrl: string;
  manifest: LocalNatsBootstrapManifest;
  port: number;
  oauthProviders?: Record<string, TrellisControlPlaneOAuthProvider>;
  failOnceHooks?: readonly string[];
}): TrellisControlPlaneConfig {
  const natsDir = join(args.workdir, "nats");
  const publicOrigin = `http://127.0.0.1:${args.port}`;
  return {
    logLevel: "info",
    port: args.port,
    instanceName: "Trellis Test",
    web: {
      origins: [publicOrigin],
      publicOrigin,
      allowInsecureOrigins: [publicOrigin, args.websocketUrl],
    },
    httpRateLimit: { windowMs: 60_000, max: 0 },
    storage: { dbPath: join(args.workdir, "trellis", "trellis.sqlite") },
    auth: {
      localIdentity: {
        enabled: true,
        passwordPolicy: { minLength: 8 },
        passwordHashing: { profile: "insecure-test-fast" },
      },
    },
    ttlMs: {
      sessions: 24 * 60 * 60_000,
      oauth: 5 * 60_000,
      deviceFlow: 30 * 60_000,
      pendingAuth: 5 * 60_000,
      connections: 2 * 60 * 60_000,
      natsJwt: 60 * 60_000,
    },
    nats: {
      servers: args.natsUrl,
      jetstream: { replicas: 1 },
      system: {
        credsPath: join(natsDir, args.manifest.paths.creds.systemService),
      },
      trellis: {
        credsPath: join(natsDir, args.manifest.paths.creds.trellisService),
      },
      auth: { credsPath: join(natsDir, args.manifest.paths.creds.authService) },
      sentinelCredsPath: join(natsDir, args.manifest.paths.creds.sentinel),
      authCallout: {
        issuer: {
          nkey: args.manifest.accounts.auth.publicKey,
          signing: Deno.readTextFileSync(
            join(natsDir, args.manifest.paths.secrets.authIssuerSigning),
          ).trim(),
        },
        target: {
          nkey: args.manifest.accounts.trellis.publicKey,
          signing: Deno.readTextFileSync(
            join(natsDir, args.manifest.paths.secrets.authTargetSigning),
          ).trim(),
        },
        sxSeed: Deno.readTextFileSync(
          join(natsDir, args.manifest.paths.secrets.authCalloutXKey),
        ).trim(),
      },
    },
    sessionKeySeed: generateSessionSeed(),
    client: {
      natsServers: [args.websocketUrl],
      nativeNatsServers: [args.natsUrl],
    },
    oauth: {
      redirectBase: `${publicOrigin}/auth/callback`,
      alwaysShowProviderChooser: false,
      providers: args.oauthProviders ?? {},
    },
    trellisTest: { failOnce: [...args.failOnceHooks ?? []] },
  };
}

/** Writes a Trellis control-plane config file and returns its path. */
export async function writeTrellisConfig(args: {
  workdir: string;
  config: TrellisControlPlaneConfig;
  configPath?: string;
}): Promise<string> {
  const configPath = args.configPath ??
    join(args.workdir, "trellis", "config.jsonc");
  await Deno.mkdir(dirname(configPath), { recursive: true });
  await Deno.writeTextFile(
    configPath,
    `${JSON.stringify(args.config, null, 2)}\n`,
  );
  return configPath;
}
