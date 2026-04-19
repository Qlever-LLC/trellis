import { AsyncResult } from "@qlever-llc/result";
import type { NatsConnection } from "@nats-io/nats-core";

export type Status = "disconnected" | "connecting" | "connected" | "error";

export type NatsStateConfig = {
  onConnecting?: () => void;
  onConnected?: () => void;
  onDisconnect?: () => void;
  onReconnecting?: () => void;
  onReconnect?: () => void;
  onError?: (error: Error) => void;
  onAuthRequired?: () => void;
};

/**
 * Svelte 5 runes-based reactive wrapper for an already-connected NATS runtime.
 */
export class NatsState {
  nc: NatsConnection;
  status: Status = $state("disconnected");

  #config: NatsStateConfig;

  private constructor(nc: NatsConnection, config: NatsStateConfig) {
    this.nc = nc;
    this.#config = config;
    this.status = "connected";
    void this.#monitorStatus(nc);
  }

  static async fromConnection(
    nc: NatsConnection,
    config: NatsStateConfig,
  ): Promise<NatsState> {
    config.onConnecting?.();
    const state = new NatsState(nc, config);
    config.onConnected?.();
    return state;
  }

  /**
   * Disconnect from NATS.
   */
  async disconnect(): Promise<void> {
    await AsyncResult.try(() => this.nc.close());
    this.status = "disconnected";
  }

  async #monitorStatus(connection: NatsConnection): Promise<void> {
    for await (const s of connection.status()) {
      if (connection !== this.nc) {
        break;
      }

      switch (s.type) {
        case "error": {
          const data = "data" in s ? s.data : s.error;
          const error = data instanceof Error ? data : new Error(String(data));
          const message = error.message.toLowerCase();
          const isAuthError = message.includes("auth") ||
            message.includes("authorization") || message.includes("authentication");

          if (isAuthError) {
            this.#config.onAuthRequired?.();
          } else if (this.status !== "connected") {
            this.status = "error";
          }

          this.#config.onError?.(error);
          break;
        }

        case "reconnect":
          this.status = "connected";
          this.#config.onReconnect?.();
          break;

        case "reconnecting":
        case "forceReconnect":
        case "staleConnection":
          this.status = "connecting";
          this.#config.onReconnecting?.();
          break;

        case "disconnect":
        case "close":
          this.status = "disconnected";
          this.#config.onDisconnect?.();
          break;

        case "ping":
        case "update":
        case "ldm":
        case "slowConsumer":
          break;

        default:
          this.status = "error";
          break;
      }
    }
  }
}

export async function createConnectedNatsState(
  nc: NatsConnection,
  config: NatsStateConfig,
): Promise<NatsState> {
  return NatsState.fromConnection(nc, config);
}
