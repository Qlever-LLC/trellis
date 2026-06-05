import type { Config } from "../config.ts";

const DEFAULT_JETSTREAM_REPLICAS = 1;
const CLUSTERED_JETSTREAM_REPLICAS = 3;
const JETSTREAM_TOPOLOGY_REQUEST = "$SYS.REQ.SERVER.PING.JSZ";

export type JetStreamTopologyRequester = {
  request(
    subject: string,
    payload?: string,
    options?: { timeout?: number },
  ): Promise<{ data: Uint8Array }>;
};

type JetStreamReplicaLogger = {
  warn: (fields: Record<string, unknown>, message: string) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function currentJetStreamMetaReplicas(jsz: unknown): number {
  if (!isRecord(jsz)) return DEFAULT_JETSTREAM_REPLICAS;
  const metaCluster = jsz.meta_cluster;
  if (!isRecord(metaCluster) || !Array.isArray(metaCluster.replicas)) {
    return DEFAULT_JETSTREAM_REPLICAS;
  }
  const current = metaCluster.replicas.filter((replica) =>
    isRecord(replica) && replica.current !== false
  );
  return current.length || DEFAULT_JETSTREAM_REPLICAS;
}

async function detectJetStreamReplicaCapacity(
  natsSystem: JetStreamTopologyRequester,
): Promise<number> {
  const response = await natsSystem.request(
    JETSTREAM_TOPOLOGY_REQUEST,
    "",
    { timeout: 1_000 },
  );
  const parsed: unknown = JSON.parse(new TextDecoder().decode(response.data));
  return currentJetStreamMetaReplicas(parsed);
}

/**
 * Resolves the JetStream replica count for Trellis-created streams and KV
 * buckets. Explicit config wins; omitted config probes NATS topology and falls
 * back to standalone-safe replicas when topology cannot be read.
 */
export async function resolveJetStreamReplicaCount(
  config: Config,
  natsSystem: JetStreamTopologyRequester,
  logger: JetStreamReplicaLogger,
): Promise<number> {
  const configuredReplicas = config.nats.jetstream.replicas;
  if (configuredReplicas !== undefined) return configuredReplicas;

  try {
    const availableReplicas = await detectJetStreamReplicaCapacity(natsSystem);
    return availableReplicas >= CLUSTERED_JETSTREAM_REPLICAS
      ? CLUSTERED_JETSTREAM_REPLICAS
      : DEFAULT_JETSTREAM_REPLICAS;
  } catch (error) {
    logger.warn(
      { error, fallbackReplicas: DEFAULT_JETSTREAM_REPLICAS },
      "Failed to detect JetStream topology; using standalone replica count",
    );
    return DEFAULT_JETSTREAM_REPLICAS;
  }
}
