import { createContext } from "svelte";
import {
  createPublicTrellis,
  type ConnectionState,
  type PublicTrellis,
  type TrellisContractLike,
  type TypedPublicTrellis,
} from "./state/trellis.svelte.ts";
import type { AuthState } from "./state/auth.svelte.ts";

export type {
  ConnectionState,
  PublicTrellis,
  TrellisContractLike,
  TypedPublicTrellis,
} from "./state/trellis.svelte.ts";
export { createPublicTrellis } from "./state/trellis.svelte.ts";

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
