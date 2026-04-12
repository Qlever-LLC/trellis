import type { Authenticator, NatsConnection } from "@nats-io/nats-core";

export type RuntimeTransportConnectOptions = {
  servers: string | string[];
  token?: string;
  authenticator?: Authenticator | Authenticator[];
  inboxPrefix?: string;
};

export type RuntimeTransport = {
  connect(options: RuntimeTransportConnectOptions): Promise<NatsConnection>;
};

function isBrowserRuntime(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function runtimeImport<TModule>(specifier: string): Promise<TModule> {
  const load = new Function("specifier", "return import(specifier);") as (
    specifier: string,
  ) => Promise<TModule>;
  return load(specifier);
}

export async function loadDefaultRuntimeTransport(): Promise<RuntimeTransport> {
  if (isBrowserRuntime()) {
    const mod = await runtimeImport<{ wsconnect: RuntimeTransport["connect"] }>(
      "@nats-io/nats-core",
    );
    return {
      connect: mod.wsconnect,
    };
  }

  if ("Deno" in globalThis) {
    const mod = await runtimeImport<{ connect: RuntimeTransport["connect"] }>(
      ["@nats-io", "transport-deno"].join("/"),
    );
    return {
      connect: mod.connect,
    };
  }

  const mod = await runtimeImport<{ connect: RuntimeTransport["connect"] }>(
    ["@nats-io", "transport-node"].join("/"),
  );
  return {
    connect: mod.connect,
  };
}
