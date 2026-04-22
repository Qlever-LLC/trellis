import type { TrellisAPI } from "../../trellis/contracts.ts";
import { createContext } from "svelte";
import {
  createPublicTrellis,
  type ConnectionState,
  type PublicTrellis,
  type TypedPublicTrellis,
} from "./state/trellis.svelte.ts";
import type { AuthState } from "./state/auth.svelte.ts";

export type {
  ConnectionState,
  PublicTrellis,
  TypedPublicTrellis,
} from "./state/trellis.svelte.ts";
export { createPublicTrellis } from "./state/trellis.svelte.ts";

export type TrellisContractLike<TA extends TrellisAPI = TrellisAPI> = {
  CONTRACT: {
    id: string;
  };
  CONTRACT_DIGEST: string;
  API: {
    trellis: TA;
  };
};

export type TrellisContext<TContract extends TrellisContractLike = TrellisContractLike> = {
  getTrellis(): Promise<TypedPublicTrellis<TContract>>;
  setTrellis(trellis: Promise<TypedPublicTrellis<TContract>>): void;
};

export type AuthContext = {
  getAuth(): AuthState;
  setAuth(auth: AuthState): void;
};

export type ConnectionStateContext = {
  getConnectionState(): Promise<ConnectionState>;
  setConnectionState(connectionState: Promise<ConnectionState>): void;
};

export type TrellisProviderContexts<
  TContract extends TrellisContractLike = TrellisContractLike,
> = {
  trellis: TrellisContext<TContract>;
  auth: AuthContext;
  connectionState: ConnectionStateContext;
};

type ProviderRuntimeContext = {
  contractId: string;
  getTrellis: () => Promise<unknown>;
};

const [getProviderTrellisContextValue, setProviderTrellisContextValue] = createContext<ProviderRuntimeContext>();
const [getProviderConnectionStateContextValue, setProviderConnectionStateContextValue] = createContext<
  Promise<ConnectionState>
>();
const [getProviderAuthContextValue, setProviderAuthContextValue] = createContext<() => AuthState>();

function createValueContext<T>() {
  const [getValue, setValue] = createContext<T>();

  return {
    getValue,
    setValue,
  };
}

/**
 * Factory for an app-local typed Trellis context.
 */
export function createTrellisContext<TContract extends TrellisContractLike>():
  TrellisContext<TContract> {
  const { getValue, setValue } = createValueContext<Promise<TypedPublicTrellis<TContract>>>();

  return {
    getTrellis(): Promise<TypedPublicTrellis<TContract>> {
      return getValue();
    },
    setTrellis(trellis: Promise<TypedPublicTrellis<TContract>>): void {
      setValue(trellis);
    },
  };
}

/**
 * Factory for an app-local auth context.
 */
export function createAuthContext(): AuthContext {
  const { getValue, setValue } = createValueContext<AuthState>();

  return {
    getAuth(): AuthState {
      return getValue();
    },
    setAuth(auth: AuthState): void {
      setValue(auth);
    },
  };
}

/**
 * Factory for an app-local connection-state context.
 */
export function createConnectionStateContext(): ConnectionStateContext {
  const { getValue, setValue } = createValueContext<Promise<ConnectionState>>();

  return {
    getConnectionState(): Promise<ConnectionState> {
      return getValue();
    },
    setConnectionState(connectionState: Promise<ConnectionState>): void {
      setValue(connectionState);
    },
  };
}

/**
 * Factory for the standard Trellis provider context bundle.
 */
export function createTrellisProviderContexts<TContract extends TrellisContractLike>():
  TrellisProviderContexts<TContract> {
  return {
    trellis: createTrellisContext<TContract>(),
    auth: createAuthContext(),
    connectionState: createConnectionStateContext(),
  };
}

export function setTrellisContext(ctx: ProviderRuntimeContext): void {
  setProviderTrellisContextValue(ctx);
}

export function setConnectionStateContext(connectionState: Promise<ConnectionState>): void {
  setProviderConnectionStateContextValue(connectionState);
}

export function setAuthContext(getAuth: () => AuthState): void {
  setProviderAuthContextValue(getAuth);
}

function isTrellisContextForContract<TContract extends TrellisContractLike>(
  ctx: ProviderRuntimeContext,
  contract: TContract,
): ctx is {
  contractId: TContract["CONTRACT"]["id"];
  getTrellis: () => Promise<PublicTrellis<TContract["API"]["trellis"]>>;
} {
  return ctx.contractId === contract.CONTRACT.id;
}

export function getTrellis<TContract extends TrellisContractLike>(
  contract: TContract,
): Promise<PublicTrellis<TContract["API"]["trellis"]>> {
  const ctx = getProviderTrellisContextValue();
  if (!isTrellisContextForContract(ctx, contract)) {
    throw new Error(`Trellis contract mismatch: expected ${contract.CONTRACT.id}, got ${ctx.contractId}`);
  }

  return ctx.getTrellis();
}

/**
 * Returns the live Trellis runtime from context for a specific contract id.
 * @param contractId The expected contract id for the current Trellis provider.
 * @returns The live runtime instance stored in Svelte context.
 * @throws {Error} If the current provider contract id does not match `contractId`.
 */
export function getTrellisRuntime(contractId: string): Promise<unknown> {
  const ctx = getProviderTrellisContextValue();
  if (ctx.contractId !== contractId) {
    throw new Error(`Trellis contract mismatch: expected ${contractId}, got ${ctx.contractId}`);
  }

  return ctx.getTrellis();
}

export function getConnectionState(): Promise<ConnectionState> {
  return getProviderConnectionStateContextValue();
}

export function getAuth(): AuthState {
  return getProviderAuthContextValue()();
}
