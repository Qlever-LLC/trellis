import type { BaseError, Result } from "@qlever-llc/result";
import type { NatsConnection } from "@nats-io/nats-core";
import type { InferSchemaType, Trellis, TrellisAPI } from "@qlever-llc/trellis";
import { createContext } from "svelte";
import { createAuthState, type AuthState, type AuthStateConfig, type SignInOptions } from "./state/auth.svelte.ts";
import type { NatsState } from "./state/nats.svelte.ts";

type TrellisContext = {
  trellis: Promise<Trellis<TrellisAPI>>;
  nats: Promise<NatsConnection>;
};

type TrellisContractLike<TA extends TrellisAPI = TrellisAPI> = {
  API: {
    trellis: TA;
  };
};

type RequestOpts = {
  timeout?: number;
};

type TypedTrellis<TA extends TrellisAPI> = Omit<Trellis<TrellisAPI>, "request" | "requestOrThrow"> & {
  request<M extends keyof TA["rpc"] & string>(
    method: M,
    input: InferSchemaType<TA["rpc"][M]["input"]>,
    opts?: RequestOpts,
  ): Promise<Result<InferSchemaType<TA["rpc"][M]["output"]>, BaseError>>;
  requestOrThrow<M extends keyof TA["rpc"] & string>(
    method: M,
    input: InferSchemaType<TA["rpc"][M]["input"]>,
    opts?: RequestOpts,
  ): Promise<InferSchemaType<TA["rpc"][M]["output"]>>;
};

function createTypedTrellis<TA extends TrellisAPI>(trellis: Trellis<TrellisAPI>): TypedTrellis<TA> {
  return trellis as TypedTrellis<TA>;
}

export type BoundTrellisApp<TContract extends TrellisContractLike> = {
  auth: AuthState;
  signIn: (options?: SignInOptions) => Promise<never>;
  getTrellis: () => Promise<TypedTrellis<TContract["API"]["trellis"]>>;
};

const [getTrellisContext, setTrellisContextValue] = createContext<TrellisContext>();
const [getNatsStateContext, setNatsStateContextValue] = createContext<Promise<NatsState>>();
const [getAuthContext, setAuthContextValue] = createContext<() => AuthState>();
const [getAppContext, setAppContextValue] = createContext<() => unknown>();

export function setTrellisContext(
  ctx: TrellisContext,
): void {
  setTrellisContextValue(ctx);
}

export function setNatsStateContext(natsState: Promise<NatsState>): void {
  setNatsStateContextValue(natsState);
}

export function setAuthContext(getAuth: () => AuthState): void {
  setAuthContextValue(getAuth);
}

export function setAppContext(getApp: () => unknown): void {
  setAppContextValue(getApp);
}

export function createTrellisApp<TContract extends TrellisContractLike>(
  config: AuthStateConfig & { contract: TContract },
): BoundTrellisApp<TContract> {
  const auth = createAuthState(config);

  let app!: BoundTrellisApp<TContract>;
  app = {
    auth,
    signIn: (options) => auth.signIn(options),
    getTrellis: () => {
      if (getAppContext()() !== app) {
        throw new Error("getTrellis() was called outside the matching TrellisProvider");
      }

      return getTrellisContext().trellis.then((trellis) =>
        createTypedTrellis<TContract["API"]["trellis"]>(trellis)
      );
    },
  };

  return app;
}

export function getNats(): Promise<NatsConnection> {
  return getTrellisContext().nats;
}

export function getNatsState(): Promise<NatsState> {
  return getNatsStateContext();
}

export function getAuth(): AuthState {
  return getAuthContext()();
}
