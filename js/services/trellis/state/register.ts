import type { createStateHandlers } from "./rpc.ts";

type StateHandlers = ReturnType<typeof createStateHandlers>;
type RpcRegistrar = {
  handle: {
    rpc: {
      state: {
        get(handler: unknown): Promise<void>;
        put(handler: unknown): Promise<void>;
        delete(handler: unknown): Promise<void>;
        list(handler: unknown): Promise<void>;
        adminGet(handler: unknown): Promise<void>;
        adminList(handler: unknown): Promise<void>;
        adminDelete(handler: unknown): Promise<void>;
      };
    };
  };
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
  await deps.trellis.handle.rpc.state.get(
    ({ input, context }: HandlerEnvelope<StateHandlers["get"]>) =>
      deps.stateHandlers.get(input, context),
  );
  await deps.trellis.handle.rpc.state.put(
    ({ input, context }: HandlerEnvelope<StateHandlers["put"]>) =>
      deps.stateHandlers.put(input, context),
  );
  await deps.trellis.handle.rpc.state.delete(
    ({ input, context }: HandlerEnvelope<StateHandlers["delete"]>) =>
      deps.stateHandlers.delete(input, context),
  );
  await deps.trellis.handle.rpc.state.list(
    ({ input, context }: HandlerEnvelope<StateHandlers["list"]>) =>
      deps.stateHandlers.list(input, context),
  );
  await deps.trellis.handle.rpc.state.adminGet(
    ({ input, context }: HandlerEnvelope<StateHandlers["adminGet"]>) =>
      deps.stateHandlers.adminGet(input, context),
  );
  await deps.trellis.handle.rpc.state.adminList(
    ({ input, context }: HandlerEnvelope<StateHandlers["adminList"]>) =>
      deps.stateHandlers.adminList(input, context),
  );
  await deps.trellis.handle.rpc.state.adminDelete(
    ({ input, context }: HandlerEnvelope<StateHandlers["adminDelete"]>) =>
      deps.stateHandlers.adminDelete(input, context),
  );
}
