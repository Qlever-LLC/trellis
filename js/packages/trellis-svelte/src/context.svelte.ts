import type { NatsConnection } from "@nats-io/nats-core";
import type { Trellis } from "@qlever-llc/trellis";
import type { InferSchemaType, TrellisAPI } from "@qlever-llc/trellis-contracts";
import { getContext, setContext } from "svelte";
import type { AuthState } from "./state/auth.svelte.ts";
import type { NatsState } from "./state/nats.svelte.ts";

const TRELLIS_KEY = Symbol("trellis");
const NATS_KEY = Symbol("nats");
const NATS_STATE_KEY = Symbol("nats-state");
const AUTH_KEY = Symbol("auth");

type TrellisContext = {
  trellis: Promise<unknown>;
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

type RpcMapFor<TA extends TrellisAPI> = {
  [M in keyof TA["rpc"] & string]: {
    input: InferSchemaType<TA["rpc"][M]["input"]>;
    output: InferSchemaType<TA["rpc"][M]["output"]>;
  };
};

type TypedRequestSurface<TA extends TrellisAPI> = {
  requestOrThrow<M extends keyof RpcMapFor<TA> & string>(
    method: M,
    input: RpcMapFor<TA>[M]["input"],
    opts?: RequestOpts,
  ): Promise<RpcMapFor<TA>[M]["output"]>;
};

type TypedTrellis<TA extends TrellisAPI> =
  & Omit<Trellis<TA>, "requestOrThrow">
  & TypedRequestSurface<TA>;

export function setTrellisContext<TA extends TrellisAPI>(
  ctx: { trellis: Promise<Trellis<TA>>; nats: Promise<NatsConnection> },
): void {
  setContext(TRELLIS_KEY, ctx.trellis as unknown as Promise<unknown>);
  setContext(NATS_KEY, ctx.nats);
}

export function setNatsStateContext(natsState: Promise<NatsState>): void {
  setContext(NATS_STATE_KEY, natsState);
}

export function setAuthContext(auth: AuthState): void {
  setContext(AUTH_KEY, auth);
}

export function getTrellis<TA extends TrellisAPI = TrellisAPI>(): Promise<Trellis<TA>> {
  return getContext<Promise<unknown>>(TRELLIS_KEY) as Promise<Trellis<TA>>;
}

export function getTrellisFor<TContract extends TrellisContractLike>(
  _contract: TContract,
): Promise<TypedTrellis<TContract["API"]["trellis"]>> {
  return getTrellis<TContract["API"]["trellis"]>() as unknown as Promise<
    TypedTrellis<TContract["API"]["trellis"]>
  >;
}

export function getNats(): Promise<NatsConnection> {
  return getContext<Promise<NatsConnection>>(NATS_KEY);
}

export function getNatsState(): Promise<NatsState> {
  return getContext<Promise<NatsState>>(NATS_STATE_KEY);
}

export function getAuth(): AuthState {
  return getContext<AuthState>(AUTH_KEY);
}
