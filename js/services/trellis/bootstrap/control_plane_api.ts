import { API as trellisAuthApi } from "../contracts/trellis_auth.ts";
import { API as trellisCoreApi } from "../contracts/trellis_core.ts";
import { API as trellisHealthApi } from "../contracts/trellis_health.ts";
import { API as trellisStateApi } from "../contracts/trellis_state.ts";

function assertNoOverlap(
  kind: string,
  left: Record<string, unknown>,
  right: Record<string, unknown>,
) {
  for (const key of Object.keys(left)) {
    if (key in right) {
      throw new Error(
        `Duplicate ${kind} key '${key}' in Trellis control-plane API`,
      );
    }
  }
}

function assertComposableApi() {
  assertNoOverlap("rpc", trellisCoreApi.owned.rpc, trellisAuthApi.owned.rpc);
  assertNoOverlap("rpc", trellisCoreApi.owned.rpc, trellisStateApi.owned.rpc);
  assertNoOverlap("rpc", trellisAuthApi.owned.rpc, trellisStateApi.owned.rpc);
  assertNoOverlap(
    "operation",
    trellisCoreApi.owned.operations,
    trellisAuthApi.owned.operations,
  );
  assertNoOverlap(
    "operation",
    trellisCoreApi.owned.operations,
    trellisStateApi.owned.operations,
  );
  assertNoOverlap(
    "operation",
    trellisAuthApi.owned.operations,
    trellisStateApi.owned.operations,
  );
  assertNoOverlap(
    "event",
    trellisCoreApi.owned.events,
    trellisAuthApi.owned.events,
  );
  assertNoOverlap(
    "event",
    trellisCoreApi.owned.events,
    trellisStateApi.owned.events,
  );
  assertNoOverlap(
    "event",
    trellisCoreApi.owned.events,
    trellisHealthApi.owned.events,
  );
  assertNoOverlap(
    "event",
    trellisAuthApi.owned.events,
    trellisStateApi.owned.events,
  );
  assertNoOverlap(
    "event",
    trellisAuthApi.owned.events,
    trellisHealthApi.owned.events,
  );
  assertNoOverlap(
    "event",
    trellisStateApi.owned.events,
    trellisHealthApi.owned.events,
  );
  assertNoOverlap(
    "subject",
    trellisCoreApi.owned.subjects,
    trellisAuthApi.owned.subjects,
  );
  assertNoOverlap(
    "subject",
    trellisCoreApi.owned.subjects,
    trellisStateApi.owned.subjects,
  );
  assertNoOverlap(
    "subject",
    trellisCoreApi.owned.subjects,
    trellisHealthApi.owned.subjects,
  );
  assertNoOverlap(
    "subject",
    trellisAuthApi.owned.subjects,
    trellisStateApi.owned.subjects,
  );
  assertNoOverlap(
    "subject",
    trellisAuthApi.owned.subjects,
    trellisHealthApi.owned.subjects,
  );
  assertNoOverlap(
    "subject",
    trellisStateApi.owned.subjects,
    trellisHealthApi.owned.subjects,
  );
  assertNoOverlap(
    "rpc",
    trellisCoreApi.trellis.rpc,
    trellisAuthApi.trellis.rpc,
  );
  assertNoOverlap(
    "rpc",
    trellisCoreApi.trellis.rpc,
    trellisStateApi.trellis.rpc,
  );
  assertNoOverlap(
    "rpc",
    trellisAuthApi.trellis.rpc,
    trellisStateApi.trellis.rpc,
  );
  assertNoOverlap(
    "rpc",
    trellisCoreApi.trellis.rpc,
    trellisHealthApi.trellis.rpc,
  );
  assertNoOverlap(
    "rpc",
    trellisAuthApi.trellis.rpc,
    trellisHealthApi.trellis.rpc,
  );
  assertNoOverlap(
    "rpc",
    trellisStateApi.trellis.rpc,
    trellisHealthApi.trellis.rpc,
  );
  assertNoOverlap(
    "operation",
    trellisCoreApi.trellis.operations,
    trellisAuthApi.trellis.operations,
  );
  assertNoOverlap(
    "operation",
    trellisCoreApi.trellis.operations,
    trellisStateApi.trellis.operations,
  );
  assertNoOverlap(
    "operation",
    trellisAuthApi.trellis.operations,
    trellisStateApi.trellis.operations,
  );
  assertNoOverlap(
    "operation",
    trellisCoreApi.trellis.operations,
    trellisHealthApi.trellis.operations,
  );
  assertNoOverlap(
    "operation",
    trellisAuthApi.trellis.operations,
    trellisHealthApi.trellis.operations,
  );
  assertNoOverlap(
    "operation",
    trellisStateApi.trellis.operations,
    trellisHealthApi.trellis.operations,
  );
  assertNoOverlap(
    "event",
    trellisCoreApi.trellis.events,
    trellisAuthApi.trellis.events,
  );
  assertNoOverlap(
    "event",
    trellisCoreApi.trellis.events,
    trellisStateApi.trellis.events,
  );
  assertNoOverlap(
    "event",
    trellisAuthApi.trellis.events,
    trellisStateApi.trellis.events,
  );
  assertNoOverlap(
    "event",
    trellisCoreApi.trellis.events,
    trellisHealthApi.trellis.events,
  );
  assertNoOverlap(
    "event",
    trellisAuthApi.trellis.events,
    trellisHealthApi.trellis.events,
  );
  assertNoOverlap(
    "event",
    trellisStateApi.trellis.events,
    trellisHealthApi.trellis.events,
  );
  assertNoOverlap(
    "subject",
    trellisCoreApi.trellis.subjects,
    trellisAuthApi.trellis.subjects,
  );
  assertNoOverlap(
    "subject",
    trellisCoreApi.trellis.subjects,
    trellisStateApi.trellis.subjects,
  );
  assertNoOverlap(
    "subject",
    trellisAuthApi.trellis.subjects,
    trellisStateApi.trellis.subjects,
  );
  assertNoOverlap(
    "subject",
    trellisCoreApi.trellis.subjects,
    trellisHealthApi.trellis.subjects,
  );
  assertNoOverlap(
    "subject",
    trellisAuthApi.trellis.subjects,
    trellisHealthApi.trellis.subjects,
  );
  assertNoOverlap(
    "subject",
    trellisStateApi.trellis.subjects,
    trellisHealthApi.trellis.subjects,
  );
}

assertComposableApi();

export const trellisControlPlaneApi = {
  owned: {
    rpc: {
      ...trellisCoreApi.owned.rpc,
      ...trellisAuthApi.owned.rpc,
      ...trellisStateApi.owned.rpc,
    },
    operations: {
      ...trellisCoreApi.owned.operations,
      ...trellisAuthApi.owned.operations,
      ...trellisStateApi.owned.operations,
    },
    events: {
      ...trellisCoreApi.owned.events,
      ...trellisAuthApi.owned.events,
      ...trellisStateApi.owned.events,
      ...trellisHealthApi.owned.events,
    },
    subjects: {
      ...trellisCoreApi.owned.subjects,
      ...trellisAuthApi.owned.subjects,
      ...trellisStateApi.owned.subjects,
      ...trellisHealthApi.owned.subjects,
    },
  },
  trellis: {
    rpc: {
      ...trellisCoreApi.trellis.rpc,
      ...trellisAuthApi.trellis.rpc,
      ...trellisStateApi.trellis.rpc,
      ...trellisHealthApi.trellis.rpc,
    },
    operations: {
      ...trellisCoreApi.trellis.operations,
      ...trellisAuthApi.trellis.operations,
      ...trellisStateApi.trellis.operations,
      ...trellisHealthApi.trellis.operations,
    },
    events: {
      ...trellisCoreApi.trellis.events,
      ...trellisAuthApi.trellis.events,
      ...trellisStateApi.trellis.events,
      ...trellisHealthApi.trellis.events,
    },
    subjects: {
      ...trellisCoreApi.trellis.subjects,
      ...trellisAuthApi.trellis.subjects,
      ...trellisStateApi.trellis.subjects,
      ...trellisHealthApi.trellis.subjects,
    },
  },
} as const;
