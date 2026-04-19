import type { TrellisAPI } from "../../trellis/contracts.ts";
import type { Trellis } from "../../trellis/trellis.ts";
import { createContext } from "svelte";
import type { AuthState } from "./state/auth.svelte.ts";
import type { Status } from "./state/nats.svelte.ts";

export type PublicTrellis<TA extends TrellisAPI = TrellisAPI> = Omit<
  Trellis<TA>,
  "nats" | "natsConnection" | "js"
>;

export type ConnectionState = {
  readonly status: Status;
  disconnect(): Promise<void>;
};

type TrellisContext<TA extends TrellisAPI = TrellisAPI> = {
  getTrellis: () => Promise<PublicTrellis<TA>>;
};

export type TrellisContractLike<TA extends TrellisAPI = TrellisAPI> = {
  API: {
    trellis: TA;
  };
};

const [getTrellisContext, setTrellisContextValue] = createContext<TrellisContext>();
const [getConnectionStateContext, setConnectionStateContextValue] = createContext<
  Promise<ConnectionState>
>();
const [getAuthContext, setAuthContextValue] = createContext<() => AuthState>();

export function setTrellisContext(
  ctx: TrellisContext,
): void {
  setTrellisContextValue(ctx);
}

export function setConnectionStateContext(connectionState: Promise<ConnectionState>): void {
  setConnectionStateContextValue(connectionState);
}

export function setAuthContext(getAuth: () => AuthState): void {
  setAuthContextValue(getAuth);
}

export function getTrellis<TA extends TrellisAPI = TrellisAPI>(): Promise<PublicTrellis<TA>> {
  return getTrellisContext().getTrellis() as unknown as Promise<PublicTrellis<TA>>;
}

export function getConnectionState(): Promise<ConnectionState> {
  return getConnectionStateContext();
}

export function getAuth(): AuthState {
  return getAuthContext()();
}
