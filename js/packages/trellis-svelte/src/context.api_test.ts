import type { TrellisAPI } from "@qlever-llc/trellis";
import type { PublicTrellis } from "./context.svelte.ts";
import { createAuthState, getConnectionState, getTrellis } from "./index.ts";

const trellisApi = {
  rpc: {},
  operations: {},
  events: {},
  subjects: {},
} satisfies TrellisAPI;

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

const authUrl: string | null = auth.authUrl;
const signInResult: Promise<never> = auth.signIn({ authUrl: "http://localhost:4000", landingPath: "/dashboard" });
const typedTrellis: Promise<PublicTrellis<TrellisAPI>> = getTrellis<TrellisAPI>();
const connectionState = getConnectionState();
const connectionStatus: Promise<"disconnected" | "connecting" | "connected" | "error"> = connectionState.then((state) => state.status);

typedTrellis.then((trellis) => {
  // @ts-expect-error clean break: raw NATS access is no longer part of the public trellis-svelte surface
  return trellis.natsConnection;
});

void authUrl;
void signInResult;
void typedTrellis;
void connectionStatus;
