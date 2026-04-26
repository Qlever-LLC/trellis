import type { Config } from "../config.ts";

type ClientTransportEndpoints = {
  natsServers: string[];
};

type ClientTransports = {
  native?: ClientTransportEndpoints;
  websocket?: ClientTransportEndpoints;
};

function splitServersCsv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function buildClientTransports(config: Config): ClientTransports {
  const nativeServers = config.client.nativeNatsServers ??
    splitServersCsv(config.nats.servers);
  const websocketServers = config.client.natsServers;

  return {
    ...(nativeServers.length > 0
      ? { native: { natsServers: nativeServers } }
      : {}),
    ...(websocketServers.length > 0
      ? { websocket: { natsServers: websocketServers } }
      : {}),
  };
}
