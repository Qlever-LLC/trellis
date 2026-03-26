import { getContext, setContext } from "svelte";
import type { TrellisAPI } from "@qlever-llc/trellis-contracts";
import type { Trellis } from "@qlever-llc/trellis-trellis";
import type { NatsConnection } from "@nats-io/nats-core";
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

export function getNats(): Promise<NatsConnection> {
  return getContext<Promise<NatsConnection>>(NATS_KEY);
}

export function getNatsState(): Promise<NatsState> {
  return getContext<Promise<NatsState>>(NATS_STATE_KEY);
}

export function getAuth(): AuthState {
  return getContext<AuthState>(AUTH_KEY);
}
