import type { NatsConnection } from "@nats-io/nats-core";
import type { Trellis } from "@qlever-llc/trellis";
import type { InferSchemaType, TrellisAPI } from "@qlever-llc/trellis-contracts";
import { createContext } from "svelte";
import type { AuthState } from "./state/auth.svelte.ts";
import type { NatsState } from "./state/nats.svelte.ts";

type AnyTrellis = Trellis<TrellisAPI>;

type TrellisContext = {
  trellis: Promise<AnyTrellis>;
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

const [getTrellisContext, setTrellisContextValue] = createContext<TrellisContext>();
const [getNatsStateContext, setNatsStateContextValue] = createContext<Promise<NatsState>>();
const [getAuthContext, setAuthContextValue] = createContext<AuthState>();

export function setTrellisContext<TA extends TrellisAPI>(
  ctx: { trellis: Promise<Trellis<TA>>; nats: Promise<NatsConnection> },
): void {
  setTrellisContextValue({
    trellis: ctx.trellis as Promise<AnyTrellis>,
    nats: ctx.nats,
  });
}

export function setNatsStateContext(natsState: Promise<NatsState>): void {
  setNatsStateContextValue(natsState);
}

export function setAuthContext(auth: AuthState): void {
  setAuthContextValue(auth);
}

export function getTrellis<TA extends TrellisAPI = TrellisAPI>(): Promise<Trellis<TA>> {
  return getTrellisContext().trellis as Promise<Trellis<TA>>;
}

export function getTrellisFor<TContract extends TrellisContractLike>(
  _contract: TContract,
): Promise<TypedTrellis<TContract["API"]["trellis"]>> {
  return getTrellis<TContract["API"]["trellis"]>() as Promise<
    TypedTrellis<TContract["API"]["trellis"]>
  >;
}

export function getNats(): Promise<NatsConnection> {
  return getTrellisContext().nats;
}

export function getNatsState(): Promise<NatsState> {
  return getNatsStateContext();
}

export function getAuth(): AuthState {
  return getAuthContext();
}
