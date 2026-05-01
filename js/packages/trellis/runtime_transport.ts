import { wsconnect } from "@nats-io/nats-core";
import type { Authenticator, NatsConnection } from "@nats-io/nats-core";

type RuntimeTransportEndpoints = {
  natsServers: string[];
};

type RuntimeTransports = {
  native?: RuntimeTransportEndpoints;
  websocket?: RuntimeTransportEndpoints;
};

export const DEFAULT_RUNTIME_MAX_RECONNECT_ATTEMPTS = -1;

export type RuntimeTransportConnectOptions = {
  servers: string | string[];
  token?: string;
  authenticator?: Authenticator | Authenticator[];
  inboxPrefix?: string;
  maxReconnectAttempts?: number;
} & Record<string, unknown>;

export type RuntimeTransport = {
  connect(options: RuntimeTransportConnectOptions): Promise<NatsConnection>;
};

type NativeGlobalThis = typeof globalThis & {
  Deno?: { version?: { deno?: string } };
};

export function selectRuntimeTransportServers(
  transports: RuntimeTransports,
): string[] {
  if (isBrowserRuntime()) {
    if (transports.websocket?.natsServers?.length) {
      return transports.websocket.natsServers;
    }
    if (transports.native?.natsServers?.length) {
      return transports.native.natsServers;
    }
  } else {
    if (transports.native?.natsServers?.length) {
      return transports.native.natsServers;
    }
    if (transports.websocket?.natsServers?.length) {
      return transports.websocket.natsServers;
    }
  }

  throw new Error("No supported NATS transport endpoints available");
}

function isBrowserRuntime(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function isDenoRuntime(): boolean {
  const load = new Function("return globalThis") as () => NativeGlobalThis;
  return typeof load().Deno?.version?.deno === "string";
}

function usesWebSocketTransport(servers: string | string[]): boolean {
  const values = Array.isArray(servers) ? servers : [servers];
  return values.some((server) =>
    server.startsWith("ws://") || server.startsWith("wss://")
  );
}

function runtimeImport<TModule>(specifier: string): Promise<TModule> {
  const load = new Function("specifier", "return import(specifier);") as (
    specifier: string,
  ) => Promise<TModule>;
  return load(specifier);
}

function denoTransportSpecifier(): string {
  return ["@nats-io", "transport-deno"].join("/");
}

function isMissingOptionalDenoTransport(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes("@nats-io/transport-deno") &&
    (error.message.includes("Could not find package") ||
      error.message.includes("Cannot find module") ||
      error.message.includes("MODULE_NOT_FOUND") ||
      error.message.includes("not a dependency") ||
      error.message.includes("not in import map"));
}

async function loadNativeDenoTransport(): Promise<RuntimeTransport> {
  try {
    return await import(denoTransportSpecifier()) as RuntimeTransport;
  } catch (error) {
    if (!isMissingOptionalDenoTransport(error)) {
      throw error;
    }
    return await runtimeImport<RuntimeTransport>(
      ["@nats-io", "transport-node"].join("/"),
    );
  }
}

export async function loadDefaultRuntimeTransport(): Promise<RuntimeTransport> {
  if (isBrowserRuntime()) {
    return {
      connect: wsconnect,
    };
  }

  if (isDenoRuntime()) {
    return {
      connect: async (options) => {
        if (usesWebSocketTransport(options.servers)) {
          return await wsconnect(options);
        }

        const mod = await loadNativeDenoTransport();
        return await mod.connect(options);
      },
    };
  }

  const mod = await runtimeImport<{ connect: RuntimeTransport["connect"] }>(
    ["@nats-io", "transport-node"].join("/"),
  );
  return {
    connect: mod.connect,
  };
}
