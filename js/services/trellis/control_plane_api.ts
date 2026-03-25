import { API as trellisAuthApi } from "./contracts/trellis_auth.ts";
import { API as trellisCoreApi } from "./contracts/trellis_core.ts";

function assertNoOverlap(kind: string, left: Record<string, unknown>, right: Record<string, unknown>) {
  for (const key of Object.keys(left)) {
    if (key in right) {
      throw new Error(`Duplicate ${kind} key '${key}' in Trellis control-plane API`);
    }
  }
}

function assertComposableApi() {
  assertNoOverlap("rpc", trellisCoreApi.owned.rpc, trellisAuthApi.owned.rpc);
  assertNoOverlap("event", trellisCoreApi.owned.events, trellisAuthApi.owned.events);
  assertNoOverlap("subject", trellisCoreApi.owned.subjects, trellisAuthApi.owned.subjects);
  assertNoOverlap("rpc", trellisCoreApi.trellis.rpc, trellisAuthApi.trellis.rpc);
  assertNoOverlap("event", trellisCoreApi.trellis.events, trellisAuthApi.trellis.events);
  assertNoOverlap("subject", trellisCoreApi.trellis.subjects, trellisAuthApi.trellis.subjects);
}

assertComposableApi();

export const trellisControlPlaneApi = {
  owned: {
    rpc: { ...trellisCoreApi.owned.rpc, ...trellisAuthApi.owned.rpc },
    events: { ...trellisCoreApi.owned.events, ...trellisAuthApi.owned.events },
    subjects: { ...trellisCoreApi.owned.subjects, ...trellisAuthApi.owned.subjects },
  },
  trellis: {
    rpc: { ...trellisCoreApi.trellis.rpc, ...trellisAuthApi.trellis.rpc },
    events: { ...trellisCoreApi.trellis.events, ...trellisAuthApi.trellis.events },
    subjects: { ...trellisCoreApi.trellis.subjects, ...trellisAuthApi.trellis.subjects },
  },
} as const;
