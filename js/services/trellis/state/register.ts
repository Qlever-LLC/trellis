import type { createStateHandlers } from "./rpc.ts";

type StateHandlers = ReturnType<typeof createStateHandlers>;
type StateRpcMethod =
  | "State.Get"
  | "State.Put"
  | "State.Delete"
  | "State.List"
  | "State.Admin.Get"
  | "State.Admin.List"
  | "State.Admin.Delete";

type RpcRegistrar = {
  mount: {
    bivarianceHack(method: StateRpcMethod, handler: unknown): Promise<void>;
  }["bivarianceHack"];
};
type HandlerEnvelope<Handler> = Handler extends
  (input: infer Input, context: infer Context) => unknown
  ? { input: Input; context: Context }
  : never;

type StateRegistrationDeps = {
  trellis: RpcRegistrar;
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
    ({ input, context }: HandlerEnvelope<StateHandlers["get"]>) =>
      deps.stateHandlers.get(input, context),
  );
  await deps.trellis.mount(
    "State.Put",
    ({ input, context }: HandlerEnvelope<StateHandlers["put"]>) =>
      deps.stateHandlers.put(input, context),
  );
  await deps.trellis.mount(
    "State.Delete",
    ({ input, context }: HandlerEnvelope<StateHandlers["delete"]>) =>
      deps.stateHandlers.delete(input, context),
  );
  await deps.trellis.mount(
    "State.List",
    ({ input, context }: HandlerEnvelope<StateHandlers["list"]>) =>
      deps.stateHandlers.list(input, context),
  );
  await deps.trellis.mount(
    "State.Admin.Get",
    ({ input, context }: HandlerEnvelope<StateHandlers["adminGet"]>) =>
      deps.stateHandlers.adminGet(input, context),
  );
  await deps.trellis.mount(
    "State.Admin.List",
    ({ input, context }: HandlerEnvelope<StateHandlers["adminList"]>) =>
      deps.stateHandlers.adminList(input, context),
  );
  await deps.trellis.mount(
    "State.Admin.Delete",
    ({ input, context }: HandlerEnvelope<StateHandlers["adminDelete"]>) =>
      deps.stateHandlers.adminDelete(input, context),
  );
}
