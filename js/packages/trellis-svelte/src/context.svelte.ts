import type { NatsConnection } from "@nats-io/nats-core";
import type { TrellisAPI } from "../../trellis/contracts.ts";
import { createContext } from "svelte";
import type { AuthState } from "./state/auth.svelte.ts";
import type { NatsState } from "./state/nats.svelte.ts";

type TrellisContext = {
  getTrellis: () => Promise<unknown>;
  getNats: () => Promise<NatsConnection>;
};

export type TrellisContractLike<TA extends TrellisAPI = TrellisAPI> = {
  API: {
    trellis: TA;
  };
};

const [getTrellisContext, setTrellisContextValue] = createContext<TrellisContext>();
const [getNatsStateContext, setNatsStateContextValue] = createContext<Promise<NatsState>>();
const [getAuthContext, setAuthContextValue] = createContext<() => AuthState>();

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

export function getTrellis<T = unknown>(): Promise<T> {
  return getTrellisContext().getTrellis() as Promise<T>;
}

export function getNats(): Promise<NatsConnection> {
  return getTrellisContext().getNats();
}

export function getNatsState(): Promise<NatsState> {
  return getNatsStateContext();
}

export function getAuth(): AuthState {
  return getAuthContext()();
}
