import { API as trellisAuthApi } from "../contracts/trellis_auth.ts";
import { API as trellisCoreApi } from "../contracts/trellis_core.ts";
import { API as trellisHealthApi } from "../contracts/trellis_health.ts";
import { API as trellisStateApi } from "../contracts/trellis_state.ts";

const CONTROL_PLANE_APIS = [
  trellisCoreApi,
  trellisAuthApi,
  trellisStateApi,
  trellisHealthApi,
] as const;

const OWNED_API_KINDS = ["rpc", "operations", "events", "subjects"] as const;
const TRELLIS_API_KINDS = ["rpc", "operations", "events", "subjects"] as const;

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
  for (
    let leftIndex = 0;
    leftIndex < CONTROL_PLANE_APIS.length;
    leftIndex += 1
  ) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < CONTROL_PLANE_APIS.length;
      rightIndex += 1
    ) {
      const left = CONTROL_PLANE_APIS[leftIndex];
      const right = CONTROL_PLANE_APIS[rightIndex];
      for (const kind of OWNED_API_KINDS) {
        assertNoOverlap(
          kind === "operations" ? "operation" : kind.slice(0, -1),
          left.owned[kind],
          right.owned[kind],
        );
      }
      for (const kind of TRELLIS_API_KINDS) {
        assertNoOverlap(
          kind === "operations" ? "operation" : kind.slice(0, -1),
          left.trellis[kind],
          right.trellis[kind],
        );
      }
    }
  }
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
