import type { trellis as trellisRuntime } from "../bootstrap/globals.ts";
import type { createStateHandlers } from "./rpc.ts";

type TrellisRuntime = typeof trellisRuntime;
type StateHandlers = ReturnType<typeof createStateHandlers>;

type StateRegistrationDeps = {
  trellis: TrellisRuntime;
  stateHandlers: StateHandlers;
};

/**
 * Registers State RPCs and State admin RPCs.
 */
export async function registerState(
  deps: StateRegistrationDeps,
): Promise<void> {
  await deps.trellis.mount(
    "State.Get",
    ({ input, context }) => deps.stateHandlers.get(input, context),
  );
  await deps.trellis.mount(
    "State.Put",
    ({ input, context }) => deps.stateHandlers.put(input, context),
  );
  await deps.trellis.mount(
    "State.Delete",
    ({ input, context }) => deps.stateHandlers.delete(input, context),
  );
  await deps.trellis.mount(
    "State.List",
    ({ input, context }) => deps.stateHandlers.list(input, context),
  );
  await deps.trellis.mount(
    "State.Admin.Get",
    ({ input, context }) => deps.stateHandlers.adminGet(input, context),
  );
  await deps.trellis.mount(
    "State.Admin.List",
    ({ input, context }) => deps.stateHandlers.adminList(input, context),
  );
  await deps.trellis.mount(
    "State.Admin.Delete",
    ({ input, context }) => deps.stateHandlers.adminDelete(input, context),
  );
}
