import { wsconnect } from "@nats-io/nats-core";
import type { Authenticator, NatsConnection } from "@nats-io/nats-core";

type RuntimeTransportEndpoints = {
  natsServers: string[];
};

type RuntimeTransports = {
  native?: RuntimeTransportEndpoints;
  websocket?: RuntimeTransportEndpoints;
};

export type RuntimeTransportConnectOptions = {
  servers: string | string[];
  token?: string;
  authenticator?: Authenticator | Authenticator[];
  inboxPrefix?: string;
};

export type RuntimeTransport = {
  connect(options: RuntimeTransportConnectOptions): Promise<NatsConnection>;
};

export function selectRuntimeTransportServers(transports: RuntimeTransports): string[] {
  if (isBrowserRuntime()) {
    if (transports.websocket?.natsServers?.length) return transports.websocket.natsServers;
    if (transports.native?.natsServers?.length) return transports.native.natsServers;
  } else {
    if (transports.native?.natsServers?.length) return transports.native.natsServers;
    if (transports.websocket?.natsServers?.length) return transports.websocket.natsServers;
  }

  throw new Error("No supported NATS transport endpoints available");
}

function isBrowserRuntime(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function usesWebSocketTransport(servers: string | string[]): boolean {
  const values = Array.isArray(servers) ? servers : [servers];
  return values.some((server) => server.startsWith("ws://") || server.startsWith("wss://"));
}

function runtimeImport<TModule>(specifier: string): Promise<TModule> {
  const load = new Function("specifier", "return import(specifier);") as (
    specifier: string,
  ) => Promise<TModule>;
  return load(specifier);
}

export async function loadDefaultRuntimeTransport(): Promise<RuntimeTransport> {
  if (isBrowserRuntime()) {
    return {
      connect: wsconnect,
    };
  }

  if ("Deno" in globalThis) {
    return {
      connect: async (options) => {
        if (usesWebSocketTransport(options.servers)) {
          return await wsconnect(options);
        }

        const mod = await runtimeImport<{ connect: RuntimeTransport["connect"] }>(
          ["@nats-io", "transport-deno"].join("/"),
        );
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
