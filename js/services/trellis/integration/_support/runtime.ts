export {
  liveTrellisTest,
  runtimeScopeForCase,
  runtimeScopeIsolated,
  startTrellisRuntime,
  trellisRepoRuntimeOptions,
  withTrellisRuntime,
} from "../../../../integration/_support/runtime.ts";
export type {
  LiveRuntimeScope,
  LiveTrellisRuntime,
  RuntimeContract,
} from "../../../../integration/_support/runtime.ts";

import type { ConsumerInfo } from "@nats-io/jetstream";
import type { LiveTrellisRuntime } from "../../../../integration/_support/runtime.ts";
import type {
  JetStreamAckObserver,
  NatsMessageObserver,
} from "../../../../packages/trellis-test/src/nats_container.ts";

/** Runtime surface for service-integration tests that inspect scratch JetStream consumers. */
export type JetStreamConsumerRuntime = LiveTrellisRuntime & {
  listTrellisJetStreamConsumers(): Promise<ConsumerInfo[]>;
  deleteJetStreamConsumer(stream: string, name: string): Promise<boolean>;
  startJetStreamAckObserver(subject?: string): Promise<JetStreamAckObserver>;
  startNatsMessageObserver(
    subject: string,
    headerNames?: readonly string[],
  ): Promise<NatsMessageObserver>;
};

/** Returns the runtime with test-only JetStream consumer inspection helpers. */
export function requireJetStreamConsumerRuntime(
  runtime: LiveTrellisRuntime,
): JetStreamConsumerRuntime {
  if (!hasJetStreamConsumerRuntime(runtime)) {
    throw new Error(
      "JetStream consumer inspection requires TrellisTestRuntime helpers",
    );
  }
  return runtime;
}

/** Restarts the Trellis control plane for isolated service-integration tests. */
export async function restartTrellisControlPlane(
  runtime: LiveTrellisRuntime,
): Promise<void> {
  if (runtime.restartControlPlane === undefined) {
    throw new Error(
      "Trellis control-plane restart requires an isolated TrellisTestRuntime",
    );
  }
  await runtime.restartControlPlane();
}

function hasJetStreamConsumerRuntime(
  runtime: LiveTrellisRuntime,
): runtime is JetStreamConsumerRuntime {
  return "listTrellisJetStreamConsumers" in runtime &&
    typeof runtime.listTrellisJetStreamConsumers === "function" &&
    "deleteJetStreamConsumer" in runtime &&
    typeof runtime.deleteJetStreamConsumer === "function" &&
    "startJetStreamAckObserver" in runtime &&
    typeof runtime.startJetStreamAckObserver === "function" &&
    "startNatsMessageObserver" in runtime &&
    typeof runtime.startNatsMessageObserver === "function";
}
