import type { TrellisAPI } from "@qlever-llc/trellis";
import { CONTRACT_STATE_METADATA } from "../../trellis/contract_support/mod.ts";
import type { Snippet } from "svelte";
import type { TrellisProviderProps } from "./components/TrellisProvider.types.ts";
import type { AuthState } from "./state/auth.svelte.ts";
import type {
  ConnectionState,
  PublicTrellis,
  TypedPublicTrellis,
} from "./context.svelte.ts";
import {
  createAuthContext,
  createAuthState,
  createConnectionStateContext,
  createTrellisContext,
  createTrellisProviderContexts,
  getConnectionState,
  getTrellis,
} from "./index.ts";

const trellisApi = {
  rpc: {},
  operations: {},
  events: {},
  subjects: {},
} satisfies TrellisAPI;

type TestContract = {
  CONTRACT: {
    format: "trellis.contract.v1";
    id: string;
    displayName: string;
    description: string;
    kind: "app";
  };
  CONTRACT_DIGEST: string;
  API: {
    trellis: typeof trellisApi;
  };
  readonly [CONTRACT_STATE_METADATA]?: {
    user: { kind: "value"; value: { id: string } };
  };
};

type OtherContract = {
  CONTRACT: TestContract["CONTRACT"];
  CONTRACT_DIGEST: string;
  API: {
    trellis: typeof trellisApi;
  };
  readonly [CONTRACT_STATE_METADATA]?: {
    session: { kind: "value"; value: { token: string } };
  };
};

const auth = createAuthState({
  authUrl: "http://localhost:4000",
  contract: {
    CONTRACT: {
      format: "trellis.contract.v1",
      id: "trellis.svelte.test@v1",
      displayName: "Trellis Svelte Test",
      description: "Type test contract",
      kind: "app",
    },
  },
  loginPath: "/login",
});

const trellisContext = createTrellisContext<TestContract>();
const authContext = createAuthContext();
const connectionStateContext = createConnectionStateContext();
const providerContexts = createTrellisProviderContexts<TestContract>();
const otherTrellisContext = createTrellisContext<OtherContract>();
const otherProviderContexts = createTrellisProviderContexts<OtherContract>();

declare const testTrellis: TypedPublicTrellis<TestContract>;
declare const testConnectionState: ConnectionState;
declare const testContract: TestContract;
declare const children: Snippet;

const providerProps: TrellisProviderProps<TestContract> = {
  children,
  contexts: providerContexts,
  trellisUrl: "http://localhost:4000",
  contract: testContract,
};

// @ts-expect-error provider contexts must match the provider contract
const invalidProviderContexts: TrellisProviderProps<TestContract>["contexts"] = otherProviderContexts;

trellisContext.setTrellis(Promise.resolve(testTrellis));
authContext.setAuth(auth);
connectionStateContext.setConnectionState(Promise.resolve(testConnectionState));

providerContexts.trellis.setTrellis(Promise.resolve(testTrellis));
providerContexts.auth.setAuth(auth);
providerContexts.connectionState.setConnectionState(Promise.resolve(testConnectionState));

const typedTrellis: Promise<TypedPublicTrellis<TestContract>> = trellisContext.getTrellis();
const bundledTypedTrellis: Promise<TypedPublicTrellis<TestContract>> = providerContexts.trellis
  .getTrellis();
const connectionState: Promise<ConnectionState> = connectionStateContext.getConnectionState();
const bundledConnectionState: Promise<ConnectionState> = providerContexts.connectionState
  .getConnectionState();
const typedAuth: AuthState = authContext.getAuth();
const bundledTypedAuth: AuthState = providerContexts.auth.getAuth();
const authUrl: string | null = typedAuth.authUrl;
const signInResult: Promise<never> = typedAuth.signIn({
  authUrl: "http://localhost:4000",
  landingPath: "/dashboard",
});

const providerTrellis: Promise<PublicTrellis<TrellisAPI>> = getTrellis({
  CONTRACT: {
    id: "trellis.svelte.test@v1",
  },
  CONTRACT_DIGEST: "digest-a",
  API: {
    trellis: trellisApi,
  },
});
const providerConnectionState = getConnectionState();
const connectionStatus: Promise<"disconnected" | "connecting" | "connected" | "error"> = providerConnectionState
  .then((state) => state.status);

typedTrellis.then((trellis) => {
  // @ts-expect-error clean break: raw NATS access is no longer part of the public trellis-svelte surface
  return trellis.natsConnection;
});

typedTrellis.then((trellis) => {
  // @ts-expect-error contract-anchored typing should reject undeclared RPC methods
  return trellis.api.rpc.notDeclared;
});

void authUrl;
void signInResult;
void typedTrellis;
void bundledTypedTrellis;
void connectionStatus;
void bundledConnectionState;
void bundledTypedAuth;
void providerProps;
void invalidProviderContexts;
void otherTrellisContext;
void providerTrellis;
